/**
 * SettingsPage — composition of all settings sections.
 * Implemented in Batch C (US-012).
 */
import { Link } from "react-router-dom";
import { PendingPriceBanner } from "../../components/settings/PendingPriceBanner";
import { OnChainWalletsSection } from "../../components/settings/OnChainWalletsSection";
import { ExchangeAccountsSection } from "../../components/settings/ExchangeAccountsSection";
import { TokensSection } from "../../components/settings/TokensSection";
import { ApiKeysSection } from "../../components/settings/ApiKeysSection";
import { BalanceValidationSection } from "../../components/settings/BalanceValidationSection";

export function SettingsPage() {
  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link
          to="/"
          className="text-sm text-indigo-400 hover:text-indigo-300"
        >
          ← Back to Portfolio
        </Link>
      </header>

      <PendingPriceBanner />

      <div className="space-y-6">
        <OnChainWalletsSection />
        <ExchangeAccountsSection />
        <TokensSection />
        <ApiKeysSection />
        <BalanceValidationSection />
      </div>
    </main>
  );
}
