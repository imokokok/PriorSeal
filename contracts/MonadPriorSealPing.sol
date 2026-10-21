// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A zero-value demonstration target for a Monad + PriorSeal exact-call run.
/// @dev This contract never holds user funds, grants token allowances, or delegates calls.
contract MonadPriorSealPing {
    error NativeValueNotAllowed();
    error RunIdRequired();
    error UnsupportedCall();

    event RunRecorded(bytes32 indexed runId, address indexed caller);

    /// @notice Emits a run identifier supplied by the caller.
    /// @dev The caller's PriorSeal authorization binds this exact calldata and zero value.
    function record(bytes32 runId) external payable {
        if (msg.value != 0) revert NativeValueNotAllowed();
        if (runId == bytes32(0)) revert RunIdRequired();
        emit RunRecorded(runId, msg.sender);
    }

    receive() external payable {
        revert NativeValueNotAllowed();
    }

    fallback() external payable {
        revert UnsupportedCall();
    }
}
