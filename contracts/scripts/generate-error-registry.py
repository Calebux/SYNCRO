#!/usr/bin/env python3
"""
Extract error code mappings from Soroban contracts and generate errors.json registry.
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

def extract_errors_from_lib(lib_path: Path) -> Dict[str, int]:
    """Extract error enum variants and their discriminants from lib.rs."""
    with open(lib_path, 'r') as f:
        content = f.read()
    
    # Find the #[contracterror] enum block
    # Pattern: looks for enum definition and extracts variant = discriminant pairs
    enum_pattern = r'#\[contracterror\].*?pub enum (\w+)\s*\{(.*?)\}'
    matches = re.finditer(enum_pattern, content, re.DOTALL)
    
    errors = {}
    for match in matches:
        enum_body = match.group(2)
        # Extract variant = discriminant pairs
        variant_pattern = r'(\w+)\s*=\s*(\d+)'
        for variant_match in re.finditer(variant_pattern, enum_body):
            variant_name = variant_match.group(1)
            discriminant = int(variant_match.group(2))
            errors[variant_name] = discriminant
    
    return errors

def build_error_registry() -> Dict[str, Dict[str, any]]:
    """Build complete error registry from all contracts."""
    # Find contracts directory (parent of scripts dir)
    contracts_dir = Path(__file__).parent.parent / "contracts"
    registry = {}
    
    for contract_name, base_code in CONTRACT_ERROR_BASES.items():
        contract_path = contracts_dir / contract_name / "src" / "lib.rs"
        
        if not contract_path.exists():
            print(f"Warning: {contract_path} not found, skipping {contract_name}")
            continue
        
        local_errors = extract_errors_from_lib(contract_path)
        
        contract_entry = {
            "contract": contract_name,
            "base_code": base_code,
            "max_code": base_code + 99,
            "errors": {}
        }
        
        for variant_name, local_code in local_errors.items():
            global_code = base_code + (local_code - 1)
            contract_entry["errors"][variant_name] = {
                "local_code": local_code,
                "global_code": global_code,
            }
        
        registry[f"{base_code}"] = contract_entry
    
    return registry

def generate_errors_json(registry: Dict) -> str:
    """Generate the errors.json file content."""
    # Flatten to mapping of global_code -> error_info
    flat_registry = {}
    
    for base_str, contract_info in registry.items():
        base_code = int(base_str)
        contract_name = contract_info["contract"]
        
        for error_name, error_info in contract_info["errors"].items():
            global_code = error_info["global_code"]
            flat_registry[str(global_code)] = {
                "contract": contract_name,
                "variant": error_name,
                "global_code": global_code,
                "local_code": error_info["local_code"],
            }
    
    # Sort by global code for readability
    sorted_registry = dict(sorted(flat_registry.items(), key=lambda x: int(x[0])))
    
    return json.dumps({
        "version": "1.0",
        "description": "Global error code registry for SYNCRO contracts (#1225)",
        "generated_at": "2026-08-30",
        "total_contracts": len(registry),
        "code_range": "1000-3199",
        "errors": sorted_registry
    }, indent=2)

if __name__ == "__main__":
    print("Generating error code registry...")
    registry = build_error_registry()
    
    print(f"Found {len(registry)} contracts")
    for base_str, info in sorted(registry.items(), key=lambda x: int(x[0])):
        num_errors = len(info["errors"])
        print(f"  {info['contract']:25s} base={info['base_code']:4d} errors={num_errors:2d}")
    
    errors_json = generate_errors_json(registry)
    output_path = Path(__file__).parent / "errors.json"
    output_path.write_text(errors_json)
    print(f"\nWrote: {output_path}")
