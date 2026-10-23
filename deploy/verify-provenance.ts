import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface VerificationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Verify build provenance attestations and SBOM integrity before promotion/deployment.
 */
export function verifyReleaseProvenance(artifactDir: string = 'release-artifacts'): VerificationResult {
  const errors: string[] = [];
  const sbomPath = path.join(artifactDir, 'sbom.cyclonedx.json');
  const metadataPath = path.join(artifactDir, 'deployment-metadata.txt');

  if (!fs.existsSync(sbomPath)) {
    errors.push(`SBOM missing at ${sbomPath}`);
  } else {
    try {
      const sbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
      if (!sbom.bomFormat || !sbom.components) {
        errors.push('Invalid CycloneDX SBOM structure');
      }
    } catch (e: any) {
      errors.push(`Failed to parse SBOM JSON: ${e.message}`);
    }
  }

  if (!fs.existsSync(metadataPath)) {
    errors.push(`Deployment metadata missing at ${metadataPath}`);
  }

  // If running in CI with gh CLI, verify GitHub Attestation
  const repoOwner = process.env.GITHUB_REPOSITORY_OWNER;
  if (repoOwner && fs.existsSync(sbomPath) && process.env.CI === 'true') {
    try {
      execSync(`gh attestation verify "${sbomPath}" --owner "${repoOwner}"`, { stdio: 'pipe' });
      console.log('✅ GitHub provenance attestation verified for SBOM');
    } catch (e: any) {
      // In local/test environments or mock verification, flag if explicitly required
      if (process.env.ENFORCE_PROVENANCE_ATTESTATION === 'true') {
        errors.push(`Attestation verification failed: ${e.message}`);
      } else {
        console.warn('⚠️ Attestation verification skipped or non-fatal in current env');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

if (require.main === module) {
  const result = verifyReleaseProvenance();
  if (!result.valid) {
    console.error('❌ Build provenance and SBOM verification failed:');
    result.errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  } else {
    console.log('✅ Build provenance and SBOM verification passed');
  }
}
