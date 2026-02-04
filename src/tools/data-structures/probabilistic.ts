
/**
 * Probabilistic Data Structures for Code Similarity
 * 
 * Implements:
 * 1. MinHash: Efficient Jaccard Similarity estimation using k-permutations.
 * 2. LSH (Locality Sensitive Hashing): Sub-linear containment search using Banding.
 */

// ============================================================================
// Hashing Utilities
// ============================================================================

/**
 * simple 32-bit FNV-1a hash
 */
function fnv1a(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/**
 * Generate k distinct deterministic hash functions for a 32-bit text hash.
 * h_i(x) = (a*x + b) % prime
 */
class HashPermutations {
    private a: Uint32Array;
    private b: Uint32Array;
    private static readonly PRIME = 4294967311; // Next prime approx 2^32

    constructor(count: number, seed: number) {
        this.a = new Uint32Array(count);
        this.b = new Uint32Array(count);

        let localSeed = seed;
        const random = () => {
            localSeed = Math.imul(localSeed, 1664525) + 1013904223;
            return (localSeed >>> 0);
        };

        for (let i = 0; i < count; i++) {
            this.a[i] = random() | 1; // Ensure odd to avoid zero multiplication issues
            this.b[i] = random();
        }
    }

    public getHashes(val: number): Uint32Array {
        const results = new Uint32Array(this.a.length);
        for (let i = 0; i < this.a.length; i++) {
            // (a * val + b) % PRIME
            // Javascript numbers are doubles, need BigInt for safe 64-bit math or careful splitting
            // Since PRIME > 2^32, (a*val) can exceed 2^53.
            // Let's use BigInt for correctness.
            const h = (BigInt(this.a[i]!) * BigInt(val) + BigInt(this.b[i]!)) % BigInt(HashPermutations.PRIME);
            results[i] = Number(h);
        }
        return results;
    }
}

// ============================================================================
// MinHash
// ============================================================================

export class MinHash {
    public signature: Uint32Array;
    private perms: HashPermutations;

    constructor(
        public readonly numPermutations: number = 128,
        seed: number = 0xDEADBEEF
    ) {
        this.signature = new Uint32Array(numPermutations).fill(0xFFFFFFFF);
        this.perms = new HashPermutations(numPermutations, seed);
    }

    /**
     * Update signature with a set of shingled inputs or direct tokens
     */
    public update(text: string, shingleSize: number = 3): void {
        if (text.length < shingleSize) {
            this.updateToken(text);
            return;
        }

        for (let i = 0; i <= text.length - shingleSize; i++) {
            const shingle = text.substring(i, i + shingleSize);
            this.updateToken(shingle);
        }
    }

    private updateToken(token: string): void {
        const val = fnv1a(token);
        const hashes = this.perms.getHashes(val);
        for (let i = 0; i < this.numPermutations; i++) {
            if (hashes[i]! < this.signature[i]!) {
                this.signature[i] = hashes[i]!;
            }
        }
    }

    public jaccard(other: MinHash): number {
        if (this.numPermutations !== other.numPermutations) {
            throw new Error("MinHash signatures must have same size");
        }

        let intersect = 0;
        for (let i = 0; i < this.numPermutations; i++) {
            if (this.signature[i] === other.signature[i]) {
                intersect++;
            }
        }
        return intersect / this.numPermutations;
    }
}

// ============================================================================
// LSH (Locality Sensitive Hashing)
// ============================================================================

export class LSHIndex {
    private bands: number;
    private rows: number;
    // Map<BandSignature, List<DocID>>[]
    private buckets: Map<string, string[]>[];

    constructor(bands: number = 20, rows: number = 5) {
        this.bands = bands;
        this.rows = rows;
        this.buckets = Array.from({ length: bands }, () => new Map());
    }

    public insert(id: string, mh: MinHash): void {
        if (mh.signature.length !== this.bands * this.rows) {
            throw new Error(`MinHash size ${mh.signature.length} != bands ${this.bands} * rows ${this.rows}`);
        }

        for (let b = 0; b < this.bands; b++) {
            const start = b * this.rows;
            const end = start + this.rows;
            const bandSig = mh.signature.slice(start, end).join(','); // Simple string key for bucket

            let bandMap = this.buckets[b];
            if (!bandMap?.has(bandSig)) {
                bandMap?.set(bandSig, []);
            }
            bandMap?.get(bandSig)!.push(id);
        }
    }

    public query(mh: MinHash): string[] {
        if (mh.signature.length !== this.bands * this.rows) {
            throw new Error(`MinHash size ${mh.signature.length} != bands ${this.bands} * rows ${this.rows}`);
        }

        const candidates = new Set<string>();

        for (let b = 0; b < this.bands; b++) {
            const start = b * this.rows;
            const end = start + this.rows;
            const bandSig = mh.signature.slice(start, end).join(',');

            const bucket = this.buckets[b]?.get(bandSig);
            if (bucket) {
                for (const id of bucket) {
                    candidates.add(id);
                }
            }
        }
        return Array.from(candidates);
    }
}

// ============================================================================
// Count-Min Sketch (Frequency Estimation)
// ============================================================================

export class CountMinSketch {
    private table: Uint32Array;
    private width: number;
    private depth: number;
    private perms: HashPermutations;

    constructor(width: number = 1000, depth: number = 5) {
        this.width = width;
        this.depth = depth;
        // Flattened 2D array [depth][width]
        this.table = new Uint32Array(width * depth);
        this.perms = new HashPermutations(depth, 0xCAFEBABE);
    }

    public add(item: string, count: number = 1): void {
        const val = fnv1a(item);
        const hashes = this.perms.getHashes(val);

        for (let i = 0; i < this.depth; i++) {
            // Map hash to bucket index [0, width-1]
            const bucket = hashes[i]! % this.width;
            const idx = i * this.width + bucket;
            this.table[idx] = (this.table[idx] || 0) + count;
        }
    }

    public estimate(item: string): number {
        const val = fnv1a(item);
        const hashes = this.perms.getHashes(val);
        let minCount = Infinity;

        for (let i = 0; i < this.depth; i++) {
            const bucket = hashes[i]! % this.width;
            const idx = i * this.width + bucket;
            minCount = Math.min(minCount, this.table[idx]!);
        }
        return minCount;
    }
}
