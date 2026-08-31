#!/usr/bin/env node

/**
 * Dependency Validation Script
 * 
 * Validates that package.json follows dependency management policies:
 * - No 'latest' versions
 * - No '*' versions
 * - No git URLs (prefer published packages)
 * - Warns about overly permissive ranges
 * 
 * Usage: node scripts/validate-deps.js
 * Exit code: 0 if valid, 1 if invalid
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function readPackageJson() {
    const packagePath = path.join(__dirname, '..', 'package.json');
    try {
        const content = fs.readFileSync(packagePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        log(`❌ Error reading package.json: ${error.message}`, 'red');
        process.exit(1);
    }
}

function validateDependencies(deps, type) {
    const errors = [];
    const warnings = [];

    if (!deps) return { errors, warnings };

    for (const [name, version] of Object.entries(deps)) {
        // Check for 'latest'
        if (version === 'latest') {
            errors.push({
                package: name,
                issue: `Uses 'latest' version`,
                fix: `Specify an exact version or semver range (e.g., "^1.2.3")`,
            });
        }

        // Check for '*'
        if (version === '*') {
            errors.push({
                package: name,
                issue: `Uses '*' wildcard version`,
                fix: `Specify an exact version or semver range (e.g., "^1.2.3")`,
            });
        }

        // Check for git URLs
        if (version.startsWith('git://') || version.startsWith('git+')) {
            warnings.push({
                package: name,
                issue: `Uses git URL instead of published package`,
                fix: `Consider using a published version from npm`,
            });
        }

        // Check for GitHub URLs
        if (version.includes('github.com')) {
            warnings.push({
                package: name,
                issue: `Uses GitHub URL instead of published package`,
                fix: `Consider using a published version from npm`,
            });
        }

        // Check for overly permissive ranges (>= without upper bound)
        if (version.startsWith('>=') && !version.includes('<')) {
            warnings.push({
                package: name,
                issue: `Uses '>=' without upper bound (allows any future version)`,
                fix: `Use caret (^) or tilde (~) range instead`,
            });
        }

        // Check for 'x' or 'X' wildcards
        if (version.includes('x') || version.includes('X')) {
            warnings.push({
                package: name,
                issue: `Uses 'x' wildcard in version`,
                fix: `Use caret (^) or tilde (~) range instead`,
            });
        }
    }

    return { errors, warnings };
}

function printIssues(issues, type, severity) {
    if (issues.length === 0) return;

    const color = severity === 'error' ? 'red' : 'yellow';
    const icon = severity === 'error' ? '❌' : '⚠️';

    log(`\n${icon} ${issues.length} ${severity}(s) in ${type}:`, color);

    issues.forEach(({ package: pkg, issue, fix }) => {
        log(`\n  Package: ${pkg}`, 'cyan');
        log(`  Issue: ${issue}`, color);
        log(`  Fix: ${fix}`, 'blue');
    });
}

function checkLockfile() {
    const lockfilePath = path.join(__dirname, '..', 'package-lock.json');

    if (!fs.existsSync(lockfilePath)) {
        log('\n⚠️  Warning: package-lock.json not found', 'yellow');
        log('  Run: npm install', 'blue');
        return false;
    }

    return true;
}

function checkNodeModules() {
    const nodeModulesPath = path.join(__dirname, '..', 'node_modules');

    if (!fs.existsSync(nodeModulesPath)) {
        log('\n⚠️  Warning: node_modules not found', 'yellow');
        log('  Run: npm install', 'blue');
        return false;
    }

    return true;
}

function validatePackageStructure(pkg) {
    const errors = [];

    // Check for required fields
    if (!pkg.name) {
        errors.push('Missing required field: name');
    }

    if (!pkg.version) {
        errors.push('Missing required field: version');
    }

    // Check for dependencies or devDependencies
    if (!pkg.dependencies && !pkg.devDependencies) {
        errors.push('No dependencies or devDependencies found');
    }

    return errors;
}

function main() {
    log('\n🔍 Validating dependencies...', 'cyan');

    // Read package.json
    const pkg = readPackageJson();

    // Validate package structure
    const structureErrors = validatePackageStructure(pkg);
    if (structureErrors.length > 0) {
        log('\n❌ Package structure errors:', 'red');
        structureErrors.forEach(error => log(`  - ${error}`, 'red'));
        process.exit(1);
    }

    // Validate dependencies
    const depsResult = validateDependencies(pkg.dependencies, 'dependencies');
    const devDepsResult = validateDependencies(pkg.devDependencies, 'devDependencies');

    // Combine results
    const allErrors = [...depsResult.errors, ...devDepsResult.errors];
    const allWarnings = [...depsResult.warnings, ...devDepsResult.warnings];

    // Print errors
    if (depsResult.errors.length > 0) {
        printIssues(depsResult.errors, 'dependencies', 'error');
    }

    if (devDepsResult.errors.length > 0) {
        printIssues(devDepsResult.errors, 'devDependencies', 'error');
    }

    // Print warnings
    if (depsResult.warnings.length > 0) {
        printIssues(depsResult.warnings, 'dependencies', 'warning');
    }

    if (devDepsResult.warnings.length > 0) {
        printIssues(devDepsResult.warnings, 'devDependencies', 'warning');
    }

    // Check for lockfile and node_modules
    log('\n📦 Checking installation files...', 'cyan');
    const hasLockfile = checkLockfile();
    const hasNodeModules = checkNodeModules();

    // Summary
    log('\n' + '='.repeat(50), 'cyan');

    if (allErrors.length === 0) {
        log('✅ All dependency validations passed!', 'green');

        if (allWarnings.length > 0) {
            log(`⚠️  ${allWarnings.length} warning(s) found (non-blocking)`, 'yellow');
        }

        if (!hasLockfile || !hasNodeModules) {
            log('\n💡 Tip: Run npm install to generate missing files', 'blue');
        }

        log('='.repeat(50) + '\n', 'cyan');
        process.exit(0);
    } else {
        log(`❌ ${allErrors.length} error(s) found`, 'red');

        if (allWarnings.length > 0) {
            log(`⚠️  ${allWarnings.length} warning(s) found`, 'yellow');
        }

        log('\n💡 Fix the errors above and run this script again', 'blue');
        log('='.repeat(50) + '\n', 'cyan');
        process.exit(1);
    }
}

// Run validation
main();
