// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Reference Safe module for authorization-enforced execution.
/// @dev This contract has not been audited. Do not enable it on a production Safe.
interface IPriorSealSafe {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
    function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8 operation) external returns (bool success);
}

contract PriorSealAuthorizationModule {
    bytes4 private constant EIP1271_MAGIC_VALUE = 0x1626ba7e;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant INTENT_TYPEHASH = keccak256("AuthorizedCall(address executor,address to,uint256 value,bytes32 dataHash,uint256 notBefore,uint256 validUntil,bytes32 nonce)");
    bytes32 private constant NAME_HASH = keccak256("PriorSeal Authorization Module");
    bytes32 private constant VERSION_HASH = keccak256("1");

    IPriorSealSafe public immutable safe;
    mapping(bytes32 nonce => bool consumed) public consumedNonces;

    struct AuthorizedCall {
        address executor;
        address to;
        uint256 value;
        bytes32 dataHash;
        uint256 notBefore;
        uint256 validUntil;
        bytes32 nonce;
    }

    event IntentExecuted(bytes32 indexed intentHash, bytes32 indexed nonce, address indexed executor, address to, uint256 value, bool success);

    constructor(address safeAddress) {
        require(safeAddress != address(0), "SAFE_REQUIRED");
        safe = IPriorSealSafe(safeAddress);
    }

    function executeAuthorized(AuthorizedCall calldata intent, bytes calldata data, bytes calldata safeSignature) external returns (bool success) {
        require(msg.sender == intent.executor, "EXECUTOR_MISMATCH");
        require(block.timestamp >= intent.notBefore, "NOT_YET_VALID");
        require(block.timestamp <= intent.validUntil, "AUTHORIZATION_EXPIRED");
        require(!consumedNonces[intent.nonce], "NONCE_ALREADY_USED");
        require(keccak256(data) == intent.dataHash, "CALLDATA_MISMATCH");
        bytes32 intentHash = hashAuthorizedCall(intent);
        require(safe.isValidSignature(intentHash, safeSignature) == EIP1271_MAGIC_VALUE, "INVALID_SAFE_SIGNATURE");
        consumedNonces[intent.nonce] = true;
        success = safe.execTransactionFromModule(intent.to, intent.value, data, 0);
        require(success, "SAFE_EXECUTION_FAILED");
        emit IntentExecuted(intentHash, intent.nonce, intent.executor, intent.to, intent.value, success);
    }

    function hashAuthorizedCall(AuthorizedCall calldata intent) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(INTENT_TYPEHASH, intent.executor, intent.to, intent.value, intent.dataHash, intent.notBefore, intent.validUntil, intent.nonce));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }
}
