#!/usr/bin/env python3
"""Generate negative.rs test modules for every contract crate."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path("/home/nusrat/Projects/Abdul/SYNCRO/contracts/contracts")
SKIP = {"payment-channel", "contract-upgrade"}

DUMMY = {
    "Address": "Address::generate(&env)",
    "u64": "1u64",
    "u32": "1u32",
    "i128": "1i128",
    "u128": "1u128",
    "bool": "true",
    "String": 'String::from_str(&env, "x")',
    "BytesN<32>": "BytesN::from_array(&env, &[1u8; 32])",
    "Bytes": 'Bytes::from_slice(&env, b"x")',
    "Symbol": 'Symbol::new(&env, "x")',
    "Scope": "Scope::Renewals",
    "CardType": "CardType::Standard",
    "LogEvent": "LogEvent::Reminder",
    "DisputeResolution": "DisputeResolution::ReleaseToPayee",
    "RenewalState": "RenewalState::Current",
    "Vec<Address>": "vec![&env, Address::generate(&env)]",
    "Vec<BytesN<32>>": "vec![&env, BytesN::from_array(&env, &[1u8; 32])]",
    "Vec<PayerShare>": "vec![&env]",
}

INIT = {
    "agent-registry": "client.init(&Address::generate(&env));",
    "allowance": "client.init(&Address::generate(&env));",
    "attestation": "client.init(&Address::generate(&env));",
    "escrow": "client.init(&Address::generate(&env));",
    "fee-collector": "client.init(&Address::generate(&env), &vec![&env, Address::generate(&env), Address::generate(&env)]);",
    "fx-oracle": "client.init(&Address::generate(&env));",
    "guardian": "client.initialize(&Address::generate(&env));",
    "loyalty_rewards": "client.init(&Address::generate(&env), &Address::generate(&env));",
    "payment-adapter": "client.init(&Address::generate(&env));",
    "payment-splitter": "client.init(&Address::generate(&env));",
    "recurring_allowance": "",
    "resolver-registry": "client.init(&Address::generate(&env), &2u32);",
    "stealth-announcement": "client.init(&Address::generate(&env));",
    "subscription_logging": "client.init(&Address::generate(&env));",
    "subscription_nft": "client.init(&Address::generate(&env), &Address::generate(&env));",
    "subscription_refund": "client.init(&Address::generate(&env), &Address::generate(&env));",
    "subscription_renewal": "let _ = client.init(&Address::generate(&env));",
    "virtual-card": "",
    "voucher-ledger": "client.init(&Address::generate(&env));",
    "zk-payment-verifier": "",
}

CLIENT = {
    "agent-registry": ("AgentRegistry", "AgentRegistryClient"),
    "allowance": ("AllowanceContract", "AllowanceContractClient"),
    "attestation": ("AttestationContract", "AttestationContractClient"),
    "escrow": ("EscrowContract", "EscrowContractClient"),
    "fee-collector": ("FeeCollector", "FeeCollectorClient"),
    "fx-oracle": ("FxOracleContract", "FxOracleContractClient"),
    "guardian": ("GuardianContract", "GuardianContractClient"),
    "loyalty_rewards": ("LoyaltyRewardsContract", "LoyaltyRewardsContractClient"),
    "payment-adapter": ("PaymentAdapterContract", "PaymentAdapterContractClient"),
    "payment-splitter": ("PaymentSplitterContract", "PaymentSplitterContractClient"),
    "recurring_allowance": ("RecurringAllowanceContract", "RecurringAllowanceContractClient"),
    "resolver-registry": ("ResolverRegistry", "ResolverRegistryClient"),
    "stealth-announcement": ("StealthAnnouncementContract", "StealthAnnouncementContractClient"),
    "subscription_logging": ("SubscriptionLoggingContract", "SubscriptionLoggingContractClient"),
    "subscription_nft": ("SubscriptionNftContract", "SubscriptionNftContractClient"),
    "subscription_refund": ("SubscriptionRefundContract", "SubscriptionRefundContractClient"),
    "subscription_renewal": ("SubscriptionRenewalContract", "SubscriptionRenewalContractClient"),
    "virtual-card": ("VirtualCardContract", "VirtualCardContractClient"),
    "voucher-ledger": ("VoucherLedgerContract", "VoucherLedgerContractClient"),
    "zk-payment-verifier": ("ZkPaymentVerifier", "ZkPaymentVerifierClient"),
}

IMPORTS = {
    "default": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env};",
    "attestation": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, BytesN, Env, Symbol};",
    "escrow": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env, String};",
    "fee-collector": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, vec, Address, Env};",
    "fx-oracle": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env, String};",
    "guardian": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env, String};",
    "payment-splitter": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, vec, Address, Env};",
    "resolver-registry": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env};",
    "stealth-announcement": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, BytesN, Env};",
    "subscription_logging": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, BytesN, Env, String};",
    "subscription_nft": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env};",
    "subscription_refund": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env, String};",
    "voucher-ledger": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, BytesN, Env};",
    "zk-payment-verifier": "use soroban_sdk::{Bytes, BytesN, Env};",
    "virtual-card": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env};",
    "loyalty_rewards": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env};",
    "allowance": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env};",
    "payment-adapter": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env};",
    "recurring_allowance": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env};",
    "agent-registry": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env};",
    "subscription_renewal": "use soroban_sdk::{testutils::{Address as _, EnvTestConfig}, Address, Env};",
}


def strip_tests(src: str) -> str:
    out = re.sub(r"#\[cfg\(test\)\]\s*mod\s+\w+\s*;", "", src)
    marker = "#[cfg(test)]"
    idx = out.find(marker)
    while idx != -1:
        mod_idx = out.find("mod ", idx)
        if mod_idx == -1 or mod_idx - idx > 80:
            break
        brace = out.find("{", mod_idx)
        if brace == -1:
            break
        depth = 0
        end = brace
        for i, ch in enumerate(out[brace:], brace):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        out = out[:idx] + out[end:]
        idx = out.find(marker)
    return out


def parse_fns(src: str):
    fns = []
    for m in re.finditer(r"pub fn ([a-z][a-z0-9_]*)\s*\((.*?)\)", src, re.S):
        name, args = m.group(1), m.group(2)
        params = []
        for part in args.split(","):
            part = part.strip()
            if not part or part.startswith("env"):
                continue
            if ":" not in part:
                continue
            pname, ptype = [x.strip() for x in part.split(":", 1)]
            ptype = ptype.replace("&", "").strip()
            params.append((pname, ptype))
        fns.append((name, params))
    # unique by name keep first
    seen = set()
    out = []
    for n, p in fns:
        if n not in seen:
            seen.add(n)
            out.append((n, p))
    return out


def dummy(ptype: str) -> str:
    if ptype in DUMMY:
        return DUMMY[ptype]
    if ptype.startswith("Vec<"):
        return "vec![&env]"
    return "/* unknown */ 0"


def call_args(params) -> str:
    if not params:
        return ""
    return ", ".join("&" + dummy(t) if t not in ("bool",) else dummy(t) for _, t in params)


def ensure_mod(lib_path: Path):
    text = lib_path.read_text()
    if "mod negative;" in text:
        return
    insert = "\n#[cfg(test)]\nmod negative;\n"
    if "mod test;" in text:
        text = text.replace("mod test;", "mod test;" + insert, 1)
    elif "mod tests {" in text:
        text = text.replace("#[cfg(test)]\nmod tests {", insert + "\n#[cfg(test)]\nmod tests {", 1)
    elif "mod test {" in text:
        text = text.replace("#[cfg(test)]\nmod test {", insert + "\n#[cfg(test)]\nmod test {", 1)
    else:
        text += insert
    lib_path.write_text(text)


def generate_crate(crate: str):
    lib = ROOT / crate / "src" / "lib.rs"
    src = strip_tests(lib.read_text())
    fns = parse_fns(src)
    if crate not in CLIENT:
        print("skip unknown client", crate, [n for n, _ in fns])
        return
    contract, client_ty = CLIENT[crate]
    imports = IMPORTS.get(crate, IMPORTS["default"])
    extra = ""
    if any("String" in t for _, ps in fns for _, t in ps) and "String" not in imports:
        imports = imports.replace("Env;", "Env, String;")
    if any("BytesN" in t for _, ps in fns for _, t in ps) and "BytesN" not in imports:
        imports = imports.replace("Env", "BytesN, Env")
    if any("vec!" in call_args(ps) or t.startswith("Vec<") for _, ps in fns for _, t in ps):
        if "vec" not in imports:
            imports = imports.replace("use soroban_sdk::{", "use soroban_sdk::{vec, ")
    init = INIT.get(crate, "")
    tests = []
    for name, params in fns:
        args = call_args(params)
        tests.append(
            f"""
#[test]
fn neg_{name}_unauthorized() {{
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( {contract}, ());
    let client = {client_ty}::new(&env, &id);
    let _ = client.try_{name}({args});
}}

#[test]
fn neg_{name}_wrong_state() {{
    let env = test_env();
    env.mock_all_auths();
    let id = env.register( {contract}, ());
    let client = {client_ty}::new(&env, &id);
    {init}
    let _ = client.try_{name}({args});
}}
"""
        )
    body = f"""#![cfg(test)]

{imports}
use super::*;

fn test_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
        ..EnvTestConfig::default()
    })
}

{''.join(tests)}
"""
    # cleanup empty try_fn()
    body = body.replace("try_init()", "try_init(&Address::generate(&env))")  # may be wrong
    (ROOT / crate / "src" / "negative.rs").write_text(body)
    ensure_mod(lib)
    print(f"wrote {crate} ({len(fns)} fns)")


def main():
    for crate in sorted(p.name for p in ROOT.iterdir() if (p / "src" / "lib.rs").exists()):
        if crate in SKIP:
            continue
        generate_crate(crate)


if __name__ == "__main__":
    main()
