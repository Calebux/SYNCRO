#!/usr/bin/env python3
"""
Batch update all contracts to use global error codes and add version functions.
"""

import re
from pathlib import Path

# Mapping of contract names to their base error codes
CONTRACTS = {
    "subscription_renewal": 1000,
    "subscription_logging": 1100,
    "virtual-card": 1200,
    # escrow already updated
    "agent-registry": 1400,
    "zk-payment-verifier": 1500,
    "payment-channel": 1600,
    "contract-upgrade": 1700,
    "allowance": 1800,
    "payment-adapter": 1900,
    "voucher-ledger": 2000,
    "fee-collector": 2100,
    "resolver-registry": 2200,
    "subscription_refund": 2300,
    "recurring_allowance": 2400,
    "loyalty_rewards": 2500,
    "subscription_nft": 2600,
    "attestation": 2700,
    "guardian": 2800,
    "fx-oracle": 2900,
    "payment-splitter": 3000,
    "stealth-announcement": 3100,
}

def get_variants(lib_path):
    """Extract error enum variants from lib.rs"""
    with open(lib_path, 'r') as f:
        content = f.read()
    
    # Find contracterror enum
    pattern = r'#\[contracterror\].*?pub enum (\w+)\s*\{(.*?)\}'
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        return None, []
    
    enum_name = match.group(1)
    enum_body = match.group(2)
    
    # Extract variants with their original discriminants
    variants = []
    for line in enum_body.split('\n'):
        # Match lines like: "    VarName = 5,"
        m = re.search(r'(\w+)\s*=\s*(\d+)', line)
        if m:
            variants.append((m.group(1), int(m.group(2))))
    
    return enum_name, variants

def update_contract(contract_dir, contract_name, base_code):
    """Update a single contract with global error codes and version functions."""
    lib_path = contract_dir / contract_name / "src" / "lib.rs"
    cargo_path = contract_dir / contract_name / "Cargo.toml"
    
    if not lib_path.exists():
        print(f"  ✗ {contract_name}: lib.rs not found")
        return False
    
    # Read the file
    with open(lib_path, 'r') as f:
        content = f.read()
    
    # Extract error enum info
    enum_name, variants = get_variants(lib_path)
    if not enum_name or not variants:
        print(f"  ℹ {contract_name}: no contracterror enum found")
        return True
    
    # Update error enum with global codes
    old_enum_pattern = r'#\[contracterror\].*?pub enum ' + enum_name + r'\s*\{.*?\}'
    
    new_enum_lines = [
        "#[contracterror]",
        "#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]",
        "#[repr(u32)]",
        f"pub enum {enum_name} {{",
    ]
    
    for var_name, local_code in variants:
        global_code = base_code + (local_code - 1)
        new_enum_lines.append(f"    {var_name} = {global_code},")
    
    new_enum_lines.append("}")
    new_enum = "\n".join(new_enum_lines)
    
    content = re.sub(old_enum_pattern, new_enum, content, flags=re.DOTALL)
    
    # Add syncro_common use if not present
    if "use syncro_common" not in content:
        # Add after soroban_sdk use
        content = re.sub(
            r'(use soroban_sdk::.*?\};)',
            r'\1\nuse syncro_common;',
            content,
            flags=re.DOTALL
        )
    
    # Add version functions if not present
    if "pub fn version(" not in content:
        # Find the end of impl block (before tests or last closing brace)
        # Insert before #[cfg(test)]
        if "#[cfg(test)]" in content:
            insertion_point = content.find("#[cfg(test)]")
            version_code = """
    /// Returns the contract version.
    /// Incremented when the implementation changes (used for deployments).
    pub fn version(_env: Env) -> u32 {
        syncro_common::version(&_env)
    }

    /// Returns the contract interface version.
    /// Incremented when public methods or error handling changes.
    /// Used to detect API mismatches at runtime.
    pub fn interface_version(_env: Env) -> u32 {
        syncro_common::interface_version_call(&_env)
    }
}

"""
            # Find the closing brace of impl block (before #[cfg(test)])
            impl_content = content[:insertion_point]
            rest = content[insertion_point:]
            
            # Find the last closing brace before #[cfg(test)]
            last_brace = impl_content.rfind("}")
            if last_brace != -1:
                content = impl_content[:last_brace] + version_code + rest
    
    # Update Cargo.toml to add syncro-common dependency
    if cargo_path.exists():
        with open(cargo_path, 'r') as f:
            cargo_content = f.read()
        
        if "syncro-common" not in cargo_content:
            # Add after soroban-sdk line in [dependencies]
            cargo_content = re.sub(
                r'(soroban-sdk = \{ workspace = true \})',
                r'\1\nsyncro-common = { path = "../common" }',
                cargo_content
            )
            with open(cargo_path, 'w') as f:
                f.write(cargo_content)
    
    # Write back
    with open(lib_path, 'w') as f:
        f.write(content)
    
    print(f"  ✓ {contract_name} ({len(variants)} error variants, base={base_code})")
    return True

def main():
    contracts_dir = Path(__file__).parent.parent / "contracts"
    
    total = 0
    for contract_name in sorted(CONTRACTS.keys()):
        if contract_name == "escrow":
            print(f"  ℹ {contract_name}: already manually updated")
            continue
        
        if update_contract(contracts_dir, contract_name, CONTRACTS[contract_name]):
            total += 1
    
    print(f"\nSuccessfully updated {total} contracts")

if __name__ == "__main__":
    main()
