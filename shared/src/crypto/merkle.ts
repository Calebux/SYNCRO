import { sha256 } from '@noble/hashes/sha256';

export interface MerkleProof {
  leaf: string;
  path: { sibling: string; position: 'left' | 'right' }[];
  root: string;
}

/**
 * Builds a Merkle tree from leaves.
 * @param leaves Array of leaves as hex strings.
 * @returns Merkle tree layers.
 */
export function buildMerkleTree(leaves: string[]): string[][] {
  const layers: string[][] = [];
  layers[0] = leaves.map((leaf) => hashLeaf(leaf));

  let layerIndex = 0;
  while (layers[layerIndex].length > 1) {
    layers[layerIndex + 1] = buildNextLayer(layers[layerIndex]);
    layerIndex++;
  }

  return layers;
}

/**
 * Gets the Merkle root from leaves.
 * @param leaves Array of leaves as hex strings.
 * @returns Merkle root as hex string.
 */
export function getMerkleRoot(leaves: string[]): string {
  const tree = buildMerkleTree(leaves);
  return tree[tree.length - 1][0];
}

/**
 * Generates a Merkle proof for a leaf.
 * @param leaves Array of leaves as hex strings.
 * @param leafIndex Index of the leaf to generate proof for.
 * @returns Merkle proof object.
 */
export function generateMerkleProof(leaves: string[], leafIndex: number): MerkleProof {
  const tree = buildMerkleTree(leaves);
  const path: { sibling: string; position: 'left' | 'right' }[] = [];
  let index = leafIndex;

  for (let layer = 0; layer < tree.length - 1; layer++) {
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;
    const layerLeaves = tree[layer];

    if (siblingIndex < layerLeaves.length) {
      path.push({
        sibling: layerLeaves[siblingIndex],
        position: isRight ? 'left' : 'right',
      });
    }

    index = Math.floor(index / 2);
  }

  return {
    leaf: leaves[leafIndex],
    path,
    root: tree[tree.length - 1][0],
  };
}

/**
 * Verifies a Merkle proof.
 * @param proof Merkle proof to verify.
 * @returns True if the proof is valid.
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  let currentHash = hashLeaf(proof.leaf);

  for (const step of proof.path) {
    if (step.position === 'left') {
      currentHash = hashPair(step.sibling, currentHash);
    } else {
      currentHash = hashPair(currentHash, step.sibling);
    }
  }

  return currentHash === proof.root;
}

function hashLeaf(leaf: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(leaf)));
}

function hashPair(a: string, b: string): string {
  const aBytes = hexToBytes(a);
  const bBytes = hexToBytes(b);
  const combined = new Uint8Array(aBytes.length + bBytes.length);
  combined.set(aBytes);
  combined.set(bBytes, aBytes.length);
  return bytesToHex(sha256(combined));
}

function buildNextLayer(layer: string[]): string[] {
  const nextLayer: string[] = [];
  for (let i = 0; i < layer.length; i += 2) {
    const left = layer[i];
    const right = layer[i + 1] || left;
    nextLayer.push(hashPair(left, right));
  }
  return nextLayer;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
