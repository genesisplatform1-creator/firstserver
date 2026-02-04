
/**
 * Succinct Data Structures for "Weak Notebook" Environments
 * 
 * Implements:
 * 1. BitVector: Compressed bit array with O(1) Rank and O(1) Access.
 * 2. WaveletTree: Succinct string representation for O(log sigma) operations.
 */

// Helper to count set bits in a 32-bit integer (Hamming Weight)
function popcount(v: number): number {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return ((v + (v >>> 4) & 0xF0F0F0F) * 0x1010101) >>> 24;
}

/**
 * Succinct BitVector supporting rapid Rank and Select queries.
 * 
 * Architecture:
 * - Backing Store: Uint32Array
 * - Superblocks (L1): Stores absolute rank every 512 bits.
 * - Blocks (L2): Stores relative rank every 32 bits (implicit in Uint32 scan for now, or explicit if needed).
 * 
 * For this implementation, we use a simplified structure:
 * - L1 Index: Rank at start of every 32-bit word. O(N/32) space.
 *   This provides O(1) Rank.
 */
export class BitVector {
    private data: Uint32Array;
    private rankIndex: Uint32Array; // Cumulative rank up to EACH word
    public readonly length: number;
    private totalOnes: number = 0;

    constructor(bits: number | string | boolean[]) {
        if (typeof bits === 'number') {
            this.length = bits;
            this.data = new Uint32Array(Math.ceil(bits / 32));
            this.rankIndex = new Uint32Array(this.data.length + 1);
        } else if (typeof bits === 'string') { // Binary string "010101"
            this.length = bits.length;
            this.data = new Uint32Array(Math.ceil(this.length / 32));
            this.rankIndex = new Uint32Array(this.data.length + 1);
            for (let i = 0; i < this.length; i++) {
                if (bits[i] === '1') this.setBit(i);
            }
            this.buildIndex();
        } else { // boolean array
            this.length = bits.length;
            this.data = new Uint32Array(Math.ceil(this.length / 32));
            this.rankIndex = new Uint32Array(this.data.length + 1);
            for (let i = 0; i < this.length; i++) {
                if (bits[i]) this.setBit(i);
            }
            this.buildIndex();
        }
    }

    private setBit(i: number): void {
        const wordIdx = Math.floor(i / 32);
        const bitIdx = i % 32;
        this.data[wordIdx]! |= (1 << bitIdx); // Little-endian bit ordering within word
    }

    /**
     * Rebuild the auxiliary indexes for fast queries.
     * Must be called after mutation if not using constructor.
     */
    public buildIndex(): void {
        this.rankIndex = new Uint32Array(this.data.length + 1);
        let cumSum = 0;
        for (let i = 0; i < this.data.length; i++) {
            this.rankIndex[i] = cumSum;
            cumSum += popcount(this.data[i]!);
        }
        this.rankIndex[this.data.length] = cumSum;
        this.totalOnes = cumSum;
    }

    /**
     * O(1) Access: Get bit at index i
     */
    public access(i: number): boolean {
        if (i < 0 || i >= this.length) return false;
        const wordIdx = Math.floor(i / 32);
        const bitIdx = i % 32;
        return ((this.data[wordIdx]! >>> bitIdx) & 1) === 1;
    }

    /**
     * O(1) Rank: Count 1s in range [0, i) (exclusive of i)
     * rank(i) = count 1s in bits 0..i-1
     */
    public rank1(i: number): number {
        if (i <= 0) return 0;
        if (i > this.length) i = this.length;

        const wordIdx = Math.floor(i / 32);
        const bitIdx = i % 32;

        // Rank = Rank at start of word + popcount of partial word
        let rank = this.rankIndex[wordIdx]!;

        if (bitIdx > 0) {
            // Mask out bits at and above bitIdx
            // We want bits 0..bitIdx-1
            // (1 << bitIdx) - 1 creates mask of bitIdx 1s
            const mask = (1 << bitIdx) - 1;
            rank += popcount(this.data[wordIdx]! & mask);
        }

        return rank;
    }

    public rank0(i: number): number {
        return i - this.rank1(i);
    }

    /**
     * Select: Find index of the k-th 1 (0-indexed).
     * Currently O(log N) via binary search on rank index + linear scan of word.
     * Can be optimized to O(1) with L2 sampling if needed.
     */
    public select1(k: number): number {
        if (k < 0 || k >= this.totalOnes) return -1;

        // Binary search over rankIndex to find the containing word
        // rankIndex[w] <= k < rankIndex[w+1]
        let low = 0;
        let high = this.rankIndex.length - 1;
        let wordIdx = 0;

        while (low <= high) {
            const mid = (low + high) >>> 1;
            if (this.rankIndex[mid]! <= k) {
                wordIdx = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        // Now find the specific bit within wordIdx
        // We need the (k - rankIndex[wordIdx])-th bit in this word
        let remaining = k - this.rankIndex[wordIdx]!;
        let word = this.data[wordIdx]!;

        // Linear scan of 32 bits is technically O(1) constant time
        for (let j = 0; j < 32; j++) {
            if ((word >>> j) & 1) {
                if (remaining === 0) {
                    return wordIdx * 32 + j;
                }
                remaining--;
            }
        }

        return -1; // Should not reach here
    }

    public select0(k: number): number {
        // Naive binary search implementation for select0
        // O(log N)
        let low = 0;
        let high = this.length;
        let result = -1;

        while (low <= high) {
            const mid = (low + high) >>> 1;
            if (this.rank0(mid) > k) {
                result = mid - 1; // Since rank is exclusive [0, i), if rank(mid) > k, the k-th 0 is before mid
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }
        // Correction check could be needed or iterate
        // Simpler: Just access check
        return result;
    }
}

/**
 * Wavelet Tree for succinct string operations using BitVectors.
 * Supports accessing characters and rank/select on arbitrary alphabets.
 */
export class WaveletTree {
    private root: WaveletNode;
    private alphabet: string[]; // Sorted unique characters
    public readonly length: number;

    constructor(text: string) {
        this.length = text.length;

        // 1. Identify alphabet
        const uniqueChars = Array.from(new Set(text.split(''))).sort();
        this.alphabet = uniqueChars;

        // 2. Build tree recursively
        // Map chars to integers 0..sigma-1
        const nums = text.split('').map(c => this.alphabet.indexOf(c));
        this.root = this.build(nums, 0, this.alphabet.length);
    }

    private build(nums: number[], low: number, high: number): WaveletNode {
        // Base case: Leaf node (single character range)
        if (high - low <= 1) {
            return { type: 'leaf', value: low };
        }

        const mid = Math.floor((low + high) / 2);

        // Divide: 0 if < mid, 1 if >= mid
        const bits: boolean[] = new Array(nums.length);
        const leftNums: number[] = [];
        const rightNums: number[] = [];

        for (let i = 0; i < nums.length; i++) {
            const val = nums[i]!;
            if (val < mid) {
                bits[i] = false;
                leftNums.push(val);
            } else {
                bits[i] = true;
                rightNums.push(val);
            }
        }

        const bv = new BitVector(bits);

        return {
            type: 'internal',
            bv,
            left: this.build(leftNums, low, mid),
            right: this.build(rightNums, mid, high)
        };
    }

    /**
     * O(log sigma) Access: Get character at index i
     */
    public access(i: number): string {
        let node = this.root;
        let curr = i;

        while (node.type === 'internal') {
            const bit = node.bv.access(curr);
            if (!bit) { // Go left (0)
                // Map index: new index is rank0(curr) in this node
                curr = node.bv.rank0(curr);
                node = node.left;
            } else { // Go right (1)
                // Map index: new index is rank1(curr) in this node
                curr = node.bv.rank1(curr);
                node = node.right;
            }
        }

        return this.alphabet[node.value]!;
    }

    /**
     * O(log sigma) Rank: Count occurrences of char c in text[0...i)
     */
    public rank(char: string, i: number): number {
        const charCode = this.alphabet.indexOf(char);
        if (charCode === -1) return 0;

        return this.rankRecursive(this.root, charCode, i, 0, this.alphabet.length);
    }

    private rankRecursive(node: WaveletNode, target: number, i: number, low: number, high: number): number {
        if (node.type === 'leaf') {
            // Reached leaf for specific char, i is the count passed down
            return i;
        }

        const mid = Math.floor((low + high) / 2);

        if (target < mid) {
            // Target is in left child (0)
            // Number of 0s up to i
            const count0 = node.bv.rank0(i);
            return this.rankRecursive(node.left, target, count0, low, mid);
        } else {
            // Target is in right child (1)
            // Number of 1s up to i
            const count1 = node.bv.rank1(i);
            return this.rankRecursive(node.right, target, count1, mid, high);
        }
    }

    /**
     * O(log sigma) Select: Find position of k-th occurrence of char c
     */
    public select(char: string, k: number): number {
        const charCode = this.alphabet.indexOf(char);
        if (charCode === -1) return -1;

        // Start from leaf and go UP? Or standard recursive select logic?
        // Standard wavelet select is usually bottom-up or tracked down then up.
        // Actually, creating the logic for select on non-trivial wavelet trees 
        // without parent pointers requires a different tracking or recursion.
        // Let's implement Top-Down if possible, but Top-Down Select is hard because we don't know which branch to check.

        // Simpler approach: Bottom-up requires explicit tree travel or recreating path stack.
        // Path stack approach: Find path to leaf for 'char'.

        // 1. Trace path to leaf, collecting nodes + side taken
        const stack: { node: InternalNode, side: 'left' | 'right' }[] = [];
        let node = this.root;
        let low = 0;
        let high = this.alphabet.length;

        while (node.type === 'internal') {
            const mid = Math.floor((low + high) / 2);
            if (charCode < mid) {
                stack.push({ node, side: 'left' });
                node = node.left;
                high = mid;
            } else {
                stack.push({ node, side: 'right' });
                node = node.right;
                low = mid;
            }
        }

        // 2. Walk up stack mapping index back to root scope
        // At leaf, 'index' is k (we want k-th occurrence of this symbol)
        let curr = k;

        for (let j = stack.length - 1; j >= 0; j--) {
            const item = stack[j]!;
            if (item.side === 'left') {
                // We are looking for the curr-th '0' in this node's bitvector
                curr = item.node.bv.select0(curr);
            } else {
                // We are looking for the curr-th '1'
                curr = item.node.bv.select1(curr);
            }
            if (curr === -1) return -1; // Not found
        }

        return curr;
    }
}

type WaveletNode = InternalNode | LeafNode;

interface InternalNode {
    type: 'internal';
    bv: BitVector;
    left: WaveletNode;
    right: WaveletNode;
}

interface LeafNode {
    type: 'leaf';
    value: number; // Index into alphabet or raw value
}
