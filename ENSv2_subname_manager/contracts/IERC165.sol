// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Vendored from the Chainlink CRE docs samples (not an npm package).
interface IERC165 {
  function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
