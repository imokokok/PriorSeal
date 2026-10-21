/**
 * Versioned compatibility entrypoint for the frozen WAK run-sheet verifier.
 *
 * v4 intentionally delegates to the maintained verifier: it reads the same
 * process arguments and performs the same read-only chain checks, while
 * keeping one audited implementation instead of allowing copied verifiers to
 * drift.
 */
import './verify-wak-frozen-multicall-sheet.mjs';
