// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Publishes externally ordered PriorSeal hash-chain checkpoints.
/// @dev Reference implementation only; ownership and deployment must be reviewed.
contract PriorSealTransparencyAnchor {
    address public owner;
    address public pendingOwner;
    uint256 public latestSize;
    bytes32 public latestHead;

    event CheckpointAnchored(uint256 indexed size, bytes32 indexed head, uint256 timestamp);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address initialOwner) {
        require(initialOwner != address(0), "OWNER_REQUIRED");
        owner = initialOwner;
    }

    function anchor(uint256 size, bytes32 head) external {
        require(msg.sender == owner, "OWNER_ONLY");
        require(size > latestSize, "SIZE_NOT_INCREASING");
        require(head != bytes32(0), "HEAD_REQUIRED");
        latestSize = size;
        latestHead = head;
        emit CheckpointAnchored(size, head, block.timestamp);
    }

    function transferOwnership(address nextOwner) external {
        require(msg.sender == owner, "OWNER_ONLY");
        require(nextOwner != address(0), "OWNER_REQUIRED");
        pendingOwner = nextOwner;
        emit OwnershipTransferStarted(owner, nextOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "PENDING_OWNER_ONLY");
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, owner);
    }
}
