pragma solidity ^0.5.11;
pragma experimental ABIEncoderV2;
import './TESTAssetHolder.sol';

/**
  * @dev This contract is a clone of the TESTAssetHolder contract. It is used for testing purposes only, to enable testing of transferAll and claimAll in multiple AssetHolders. It has a dummy storage variable in order to change the ABI. TODO remove the need for this contract by allowing TESTAssetHolder to be deployed twice.
*/
contract TESTAssetHolder2 is TESTAssetHolder {
    bool public dummy;
}
