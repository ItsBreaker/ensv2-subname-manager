// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC165} from "./IERC165.sol";

// Vendored from the Chainlink CRE docs samples (not an npm package).
// The CRE forwarder calls onReport(metadata, report) on the consumer.
interface IReceiver is IERC165 {
  function onReport(bytes calldata metadata, bytes calldata report) external;
}
