#!/usr/bin/env python3
"""
Generate updated error enums for all Soroban contracts with global error codes.
This script updates each contract's error enum to use the allocated range from ERROR_CODE_REGISTRY.
"""

import re
import json
from pathlib import Path
from typing import Dict, List, Tuple

# Contract-to-base-code mapping
CONTRACT_ERROR_BASES = {
    "subscription_renewal": 1000,
    "subscription_logging": 1100,
    "virtual-card": 1200,
    "escrow": 1300,
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

def extract_error_enum(lib_content: str) -> Tuple[str, str, str]:
    """Extract the contracterror enum block from lib.rs."""
    # Find the contracterror enum
    pattern = r'(#\[contracterror\].*?pub enum \w+\s*\{.*?\})'
    match = re.search(pattern, lib_content, re.DOTALL)
    if not match:
        return None, None, None
    
    enum_block = match.group(1)
    start_pos = match.start()
    end_pos = match.end()
    
    # Extract enum name and variants
    enum_name_pattern = r'pub enum (\w+)'
    enum_name_match = re.search(enum_name_pattern, enum_block)
    enum_name = enum_name_match.group(1) if enum_name_match else None
    
    before = lib_content[:start_pos]
    after = lib_content[end_pos:]
    
    return enum_block, enum_name, (before, after)

def extract_variants(enum_block: str) -> List[Tuple[str, int]]:
    """Extract variant names and discriminants from error enum."""
    variant_pattern = r'(\w+)\s*=\s*(\d+)'
    variants = []
    for match in re.finditer(variant_pattern, enum_block):
        name = match.group(1)
        disc = int(match.group(2))
        variants.append((name, disc))
    return sorted(variants, key=lambda x: x[1])

def update_contract_error_enum(lib_path: Path, base_code: int) -> bool:
    """Update a single contract's error enum with global error codes."""
    with open(lib_path, 'r') as f:
        content = f.read()
    
    old_enum, enum_name, (before, after) = extract_error_enum(content)
    if not old_enum or not enum_name:
        print(f"  ⚠ No contracterror enum found in {lib_path}")
        return False
    
    variants = extract_variants(old_enum)
    if not variants:
        print(f"  ⚠ No error variants found in {lib_path}")
        return False
    
    # Build new enum with global codes
    new_enum_lines = [
        "#[contracterror]",
        "#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]",
        "#[repr(u32)]",
        f"pub enum {enum_name} {{",
    ]
    
    for variant_name, local_code in variants:
        global_code = base_code + (local_code - 1)
        new_enum_lines.append(f"    {variant_name} = {global_code},")
    
    new_enum_lines.append("}")
    
    new_enum = "\n".join(new_enum_lines)
    new_content = before + new_enum + after
    
    with open(lib_path, 'w') as f:
        f.write(new_content)
    
    print(f"  ✓ Updated {enum_name} in {lib_path.parent.name}")
    return True

def add_version_to_contract(lib_path: Path, contract_name: str) -> bool:
    """Add version() and interface_version() functions to a contract."""
    with open(lib_path, 'r') as f:
        content = f.read()
    
    # Check if version() already exists
    if re.search(r'pub fn version\(', content):
        print(f"  ℹ version() already exists in {contract_name}")
        return False
    
    # Find the end of the contractimpl impl block
    # We'll add the version functions before the final closing brace
    
    impl_pattern = r'(#\[contractimpl\].*?^})[\s\n]*($|\})'
    match = re.search(impl_pattern, content, re.MULTILINE | re.DOTALL)
    
    if not match:
        print(f"  ⚠ Could not find #[contractimpl] block in {contract_name}")
        return False
    
    version_code = '''
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
    }'''
    
    # Insert before the final closing brace
    insertion_point = match.start(1)
    new_content = content[:insertion_point] + version_code + "\n" + content[insertion_point:]
    
    with open(lib_path, 'w') as f:
        f.write(new_content)
    
    print(f"  ✓ Added version() and interface_version() to {contract_name}")
    return True

def add_common_dependency(cargo_path: Path) -> bool:
    """Add syncro-common as a dependency to contract's Cargo.toml."""
    with open(cargo_path, 'r') as f:
        content = f.read()
    
    # Check if already present
    if 'syncro-common' in content:
        return False
    
    # Find [dependencies] section and add syncro-common
    # Pattern: find [dependencies] and add after it
    deps_pattern = r'(\[dependencies\])\n'
    
    if not re.search(deps_pattern, content):
        print(f"  ⚠ No [dependencies] section found in {cargo_path}")
        return False
    
    new_dep = 'syncro-common = { path = "../common" }\n'
    new_content = re.sub(
        r'(\[dependencies\])\n',
        r'\1\n' + new_dep,
        content
    )
    
    with open(cargo_path, 'w') as f:
        f.write(new_content)
    
    print(f"  ✓ Added syncro-common dependency to {cargo_path.name}")
    return True

def main():
    contracts_dir = Path(__file__).parent.parent / "contracts"
    
    for contract_name, base_code in sorted(CONTRACT_ERROR_BASES.items()):
        lib_path = contracts_dir / contract_name / "src" / "lib.rs"
        cargo_path = contracts_dir / contract_name / "Cargo.toml"
        
        if not lib_path.exists():
            print(f"⚠ Skipping {contract_name}: lib.rs not found")
            continue
        
        print(f"\nUpdating {contract_name} (base={base_code})...")
        
        # Add dependency first
        if cargo_path.exists():
            add_common_dependency(cargo_path)
        
        # Update error enum
        update_contract_error_enum(lib_path, base_code)
        
        # Add version functions
        add_version_to_contract(lib_path, contract_name)

if __name__ == "__main__":
    main()
