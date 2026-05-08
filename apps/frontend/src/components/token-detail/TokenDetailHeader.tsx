import { Link } from "react-router-dom";
import { TokenLogo } from "../dashboard/TokenLogo";
import { NetworkBadge } from "../dashboard/NetworkBadge";
import { CycleBadge } from "./CycleBadge";
import { WalletSelector } from "./WalletSelector";
import type { TokenInfo, PositionStats } from "../../types/token-detail";

interface TokenDetailHeaderProps {
  token: TokenInfo;
  position: PositionStats | null;
  closedCycleCount: number;
  selectedWalletId: string | undefined;
  onWalletChange: (walletId: string | undefined) => void;
}

export function TokenDetailHeader({
  token,
  position,
  closedCycleCount,
  selectedWalletId,
  onWalletChange,
}: TokenDetailHeaderProps) {
  const cycleCount = closedCycleCount;

  return (
    <div className="flex flex-wrap items-center gap-4 p-6">
      {/* Logo */}
      <TokenLogo
        symbol={token.symbol}
        contractAddress={token.contractAddress}
        network={token.network}
        size="lg"
      />

      {/* Name + badges */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-white">{token.symbol}</h1>
          <NetworkBadge network={token.network} />
          <CycleBadge cycleNumber={position?.cycleNumber} />
        </div>
        {token.name && (
          <p className="text-sm text-gray-400">{token.name}</p>
        )}
      </div>

      {/* Spacer + actions */}
      <div className="ml-auto flex items-center gap-3">
        {/* Wallet selector — only for ON_CHAIN */}
        {token.network !== "CEX_BINANCE" && position && (
          <WalletSelector
            wallets={position.walletBreakdown}
            selectedWalletId={selectedWalletId}
            onChange={onWalletChange}
          />
        )}

        {/* Closed cycles link */}
        {cycleCount > 0 && (
          <Link
            to={`/token/${token.contractAddress}/${token.network}/history`}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            View {cycleCount} closed cycle{cycleCount !== 1 ? "s" : ""}
          </Link>
        )}
      </div>
    </div>
  );
}
