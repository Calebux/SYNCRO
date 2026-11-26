export {
  CHANNEL_SCOPE,
  ChannelClient,
  ChannelScopeError,
} from "./client.js";
export type {
  AutoTopUpConfig,
  ChallengePeriod,
  ChannelBalance,
  ChannelClientOptions,
  ChannelInvocation,
  ChannelLifecycleState,
  ChannelOperation,
  ChannelScope,
  ChannelTransport,
  ChannelView,
  CloseResult,
  EnsureFundedResult,
  InitiateCloseInput,
  OpenChannelInput,
} from "./client.js";

// ─── Multi-asset channel selection (issue #1807) ─────────────────────────────
export {
  NoCompatibleChannelError,
  selectChannelForAsset,
  readAcceptedAssets,
  parseAssetId,
  assetMatches,
} from "./asset-selector.js";
export type {
  AssetId,
  AssetSelectorOptions,
  ChannelDescriptor,
  X402Challenge,
  X402Requirement,
  ProviderManifest,
} from "./asset-selector.js";

// ─── Consumer-side dispute watcher (issue #1796) ─────────────────────────────
export { watchChannels } from "./watcher.js";
export type {
  ChannelStateStore,
  DisputeSigner,
  SignedChannelState,
  WatchChannelsOptions,
  WatchHandle,
  DisputeSubmittedEvent,
  DeadlineApproachingEvent,
  DisputeErrorEvent,
} from "./watcher.js";
