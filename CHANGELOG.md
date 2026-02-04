# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2025-02-04

### Added
- **Immutable Audit Log**: Implemented Merkle Tree-based cryptographic lineage tracking for all tool executions.
- **Advanced Data Structures**:
  - `ds_hyperloglog`: High-scale cardinality estimation (e.g., for massive log analysis).
  - `ds_wavelet_ops`: Wavelet Trees for O(1) rank/select operations on large texts.
  - `ds_graph_gomory_hu`: Min-cut analysis for code coupling and service boundary detection.
- **Performance Benchmarks**:
  - Validated 60-80 TPS throughput.
  - Sub-10ms latency for standard operations.
  - Context safety mechanisms (file offloading for large payloads).
- **Security Infrastructure**:
  - Added `SECURITY.md` with vulnerability model and reporting policy.
  - Integrated `npm audit` scanning capability.
- **CI/CD**:
  - Added GitHub Actions workflow (`.github/workflows/test.yml`) for automated testing on Node.js 18.x/20.x.
- **Documentation**:
  - Comprehensive `README.md` with concrete use cases, code examples, and troubleshooting.
  - Documented resource limits (Concurrency, Memory, Storage).

### Changed
- **Renamed**: "Mahfuz Integrity" -> "Immutable Audit Log" for clarity and professionalism.
- **Refactored**: Simplified `lineage_track` tool to be a clean audit log viewer.
- **Fixed**: Resolved installation path issues in documentation (removed hardcoded Windows paths).
- **Fixed**: Corrected `ssa.test.ts` imports to ensure 100% test passing rate.

### Infrastructure
- **Architecture**: Validated ECS (Entity Component System) usage for clean state isolation.
- **Persistence**: Documented synchronous SQLite trade-offs for data integrity.
