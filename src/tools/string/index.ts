
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getEventStore } from '../../durability/event-store.js';

// ============================================================================
// Types & Schemas
// ============================================================================

const StringInputSchema = z.object({
    text: z.string(),
});

const PatternsInputSchema = z.object({
    text: z.string(),
    patterns: z.array(z.string()),
});

// ============================================================================
// Algorithms
// ============================================================================

/**
 * 1. Suffix Tree (Simplified O(n^2) construction)
 * Represents a compressed trie of all suffixes.
 */
class SuffixNode {
    children: Map<string, SuffixNode> = new Map();
    start: number;
    end: number | null; // null means "end of string" implied? No, explicit indices.
    suffixLink: SuffixNode | null = null;
    index: number = -1; // Suffix index if leaf

    constructor(start: number, end: number | null) {
        this.start = start;
        this.end = end;
    }
}

class SuffixTree {
    root: SuffixNode;
    text: string;

    constructor(text: string) {
        this.text = text + '$'; // Sentinel
        this.root = new SuffixNode(-1, -1);
        this.buildNaive();
    }

    private buildNaive() {
        // Insert all suffixes
        for (let i = 0; i < this.text.length; i++) {
            this.insertSuffix(i);
        }
    }

    private insertSuffix(start: number) {
        let node = this.root;
        let curr = start;

        while (curr < this.text.length) {
            // Find child starting with text[curr]
            let child: SuffixNode | undefined;
            // Scan children (Map keys are first chars)
            for (const [key, c] of node.children) {
                if (key.startsWith(this.text[curr]!)) { // Optimization: Map key could be just first char
                    child = c;
                    break;
                }
            }

            // Optimization: Store first char as key
            const char = this.text[curr]!;
            child = node.children.get(char);

            if (!child) {
                // New leaf
                const leaf = new SuffixNode(curr, this.text.length);
                leaf.index = start;
                node.children.set(char, leaf);
                return;
            }

            // Match along edge
            let edgeStart = child.start;
            let edgeEnd = child.end ?? this.text.length; // usually leaf end is max
            let len = 0;

            // Walk edge
            while (edgeStart + len < edgeEnd && curr + len < this.text.length) {
                if (this.text[edgeStart + len] !== this.text[curr + len]) {
                    // Mismatch - Split edge
                    const splitNode = new SuffixNode(child.start, child.start + len);
                    splitNode.children.set(this.text[edgeStart + len]!, child);

                    // Update child
                    child.start += len;

                    // New leaf
                    const leaf = new SuffixNode(curr + len, this.text.length);
                    leaf.index = start;
                    splitNode.children.set(this.text[curr + len]!, leaf);

                    // Update parent
                    node.children.set(char, splitNode);
                    return;
                }
                len++;
            }

            // Consumed edge
            curr += len;
            node = child;
        }
    }

    // JSON representation for visualization
    toJSON() {
        return this.serialize(this.root);
    }

    private serialize(node: SuffixNode): any {
        const children: any = {};
        for (const [char, child] of node.children) {
            // Edge label
            const label = this.text.slice(child.start, child.end ?? this.text.length);
            children[label] = this.serialize(child);
        }
        return Object.keys(children).length > 0 ? children : (node.index >= 0 ? { idx: node.index } : {});
    }
}

/**
 * 2. Aho-Corasick Algorithm
 * Multi-pattern string matching using automaton.
 */
class AhoCorasick {
    trie: any[] = [{ next: {}, fail: 0, output: [] }];

    constructor(patterns: string[]) {
        this.build(patterns);
    }

    private build(patterns: string[]) {
        // 1. Build Trie
        for (let i = 0; i < patterns.length; i++) {
            let node = 0;
            const pat = patterns[i]!;
            for (const char of pat) {
                if (!this.trie[node].next[char]) {
                    this.trie.push({ next: {}, fail: 0, output: [] });
                    this.trie[node].next[char] = this.trie.length - 1;
                }
                node = this.trie[node].next[char];
            }
            this.trie[node].output.push(i); // Store pattern index
        }

        // 2. Build Failure Links (BFS)
        const queue: number[] = [];
        // Init depth 1
        for (const char in this.trie[0].next) {
            const nextNode = this.trie[0].next[char];
            queue.push(nextNode);
            this.trie[nextNode].fail = 0;
        }

        while (queue.length > 0) {
            const r = queue.shift()!;
            for (const char in this.trie[r].next) {
                const u = this.trie[r].next[char];
                queue.push(u);

                let v = this.trie[r].fail;
                while (v !== 0 && !this.trie[v].next[char]) {
                    v = this.trie[v].fail;
                }
                this.trie[u].fail = this.trie[v].next[char] || 0;
                this.trie[u].output.push(...this.trie[this.trie[u].fail].output);
            }
        }
    }

    search(text: string): { patternIndex: number, position: number }[] {
        let node = 0;
        const results: { patternIndex: number, position: number }[] = [];

        for (let i = 0; i < text.length; i++) {
            const char = text[i]!;
            while (node !== 0 && !this.trie[node].next[char]) {
                node = this.trie[node].fail;
            }
            node = this.trie[node].next[char] || 0;

            for (const idx of this.trie[node].output) {
                results.push({ patternIndex: idx, position: i });
            }
        }
        return results;
    }
}

/**
 * 3. Burrows-Wheeler Transform & FM-Index (Simplified)
 */
function computeBWT(text: string): { bwt: string, suffixArray: number[] } {
    const t = text + '$';
    const sa = Array.from({ length: t.length }, (_, i) => i);
    sa.sort((a, b) => {
        // Compare suffixes starting at a and b
        // Full string comparisons - O(n^2 log n)
        // Production would use SA-IS O(n) or Skew algorithm
        if (t.slice(a) < t.slice(b)) return -1;
        if (t.slice(a) > t.slice(b)) return 1;
        return 0;
    });

    const bwt = sa.map(i => {
        return i === 0 ? t[t.length - 1]! : t[i - 1]!;
    }).join('');

    return { bwt, suffixArray: sa };
}

/**
 * 4. Lyndon Factorization (Duval's Algorithm)
 * Decompose string into strict Lyndon words s = w1 w2 ... wk where w1 >= w2 >= ... >= wk
 */
function lyndonFactorization(text: string): string[] {
    const factors: string[] = [];
    let k = 0;
    const n = text.length;

    while (k < n) {
        let i = k;
        let j = k + 1;
        while (j < n && text[i]! <= text[j]!) {
            if (text[i]! < text[j]!) {
                i = k;
            } else {
                i++;
            }
            j++;
        }
        while (k <= i) {
            factors.push(text.substring(k, k + j - i));
            k += j - i;
        }
    }
    return factors;
}

// ============================================================================
// Tool Registration
// ============================================================================

export function registerStringTools(server: McpServer): void {

    server.tool(
        'string_suffix_tree',
        'Build Suffix Tree (Naive O(n^2)). Returns JSON structure.',
        { text: z.string() },
        async ({ text }) => {
            const tree = new SuffixTree(text);
            return {
                content: [{ type: 'text', text: JSON.stringify(tree.toJSON(), null, 2) }]
            };
        }
    );

    server.tool(
        'string_aho_corasick',
        'Multi-pattern search using Aho-Corasick automaton.',
        {
            text: z.string(),
            patterns: z.array(z.string())
        },
        async ({ text, patterns }) => {
            const ac = new AhoCorasick(patterns);
            const matches = ac.search(text);
            // Format results
            const grouped = matches.map(m => ({
                pattern: patterns[m.patternIndex],
                endIndex: m.position
            }));

            return {
                content: [{ type: 'text', text: JSON.stringify(grouped, null, 2) }]
            };
        }
    );

    server.tool(
        'string_bwt_fmindex',
        'Compute Burrows-Wheeler Transform and Suffix Array.',
        { text: z.string() },
        async ({ text }) => {
            const { bwt, suffixArray } = computeBWT(text);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ bwt, suffixArray }, null, 2)
                }]
            };
        }
    );

    server.tool(
        'string_lyndon',
        'Compute Lyndon Factorization (Duval\'s Algorithm).',
        { text: z.string() },
        async ({ text }) => {
            const factors = lyndonFactorization(text);
            return {
                content: [{ type: 'text', text: JSON.stringify(factors, null, 2) }]
            };
        }
    );
}
