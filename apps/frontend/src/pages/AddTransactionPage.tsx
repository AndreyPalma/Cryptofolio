/**
 * AddTransactionPage — manual transaction entry form.
 * Route: /transactions/new
 *
 * Architecture:
 * - Local controlled state for all form fields
 * - Validation runs on submit (not on-change)
 * - Uses useWallets, useTokensByWallet, useWalletBalance, useTransferInSuggestion, useCreateTransaction
 * - On success: toast + navigate to /token/:address/:network
 * - On error: inline field errors
 */
import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useWallets } from "../hooks/useWallets";
import { useTokensByWallet } from "../hooks/useTokensByWallet";
import { useWalletBalance } from "../hooks/useWalletBalance";
import { useTransferInSuggestion } from "../hooks/useTransferInSuggestion";
import { useCreateTransaction } from "../hooks/useCreateTransaction";
import { useToast } from "../hooks/useToast";
import { validateAmount, validatePriceUsd, isOutbound, isPriceRequired } from "../lib/transaction-rules";
import type { TransactionType } from "../types/token-detail";
import { WalletSourceSelect } from "../components/add-transaction/WalletSourceSelect";
import { TokenSelect } from "../components/add-transaction/TokenSelect";
import { TransactionTypeSelect } from "../components/add-transaction/TransactionTypeSelect";
import { DateTimeInput } from "../components/add-transaction/DateTimeInput";
import { AmountInput } from "../components/add-transaction/AmountInput";
import { PriceUsdInput } from "../components/add-transaction/PriceUsdInput";
import { WacPreview } from "../components/add-transaction/WacPreview";
import { InheritWacSuggestion } from "../components/add-transaction/InheritWacSuggestion";
import { SubmitBar } from "../components/add-transaction/SubmitBar";

function initialNowLocal(): string {
  const now = new Date();
  // YYYY-MM-DDTHH:mm
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

interface FieldErrors {
  wallet?: string;
  token?: string;
  type?: string;
  amount?: string;
  priceUsd?: string;
  dateLocal?: string;
  [key: string]: string | undefined;
}

export function AddTransactionPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { show: showToast } = useToast();

  // Form state
  const [walletId, setWalletId] = useState<string>(searchParams.get("wallet_id") ?? "");
  const [tokenId, setTokenId] = useState<string>(searchParams.get("token_id") ?? "");
  const [type, setType] = useState<TransactionType>("BUY");
  const [amount, setAmount] = useState<string>("");
  const [priceUsd, setPriceUsd] = useState<string>("");
  const [dateLocal, setDateLocal] = useState<string>(initialNowLocal());
  const [costSource, setCostSource] = useState<"MANUAL" | "INHERITED">("MANUAL");

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Data hooks
  const { data: wallets } = useWallets();
  const selectedWallet = wallets?.find((w) => w.id === walletId) ?? null;
  const { data: tokens } = useTokensByWallet(selectedWallet);
  const selectedToken = tokens?.find((t) => t.id === tokenId) ?? null;

  // Balance for preview + guard
  const { balance: currentBalance, wac: currentWac } = useWalletBalance(
    walletId,
    selectedToken?.contractAddress ?? "",
    selectedToken?.network ?? "",
  );

  // Wallets map for TRANSFER_IN suggestion (React Compiler handles memoization)
  const walletsByType = new Map<string, NonNullable<typeof selectedWallet>>();
  for (const w of wallets ?? []) {
    walletsByType.set(w.id, w);
  }

  const { candidate: inheritCandidate, loading: inheritLoading } = useTransferInSuggestion(
    selectedToken,
    walletId || null,
    type,
    walletsByType,
  );

  const { submit } = useCreateTransaction();

  // Derived: is outbound type + balance check
  const isOutboundType = isOutbound(type);
  const parsedAmount = parseFloat(amount);
  const parsedBalance = currentBalance !== null ? parseFloat(currentBalance) : null;
  const isOverBalance =
    isOutboundType &&
    parsedBalance !== null &&
    !Number.isNaN(parsedAmount) &&
    parsedAmount > parsedBalance;

  // Submit guard
  const isSubmitDisabled =
    submitting ||
    isOverBalance;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const errors: FieldErrors = {};

    // Guard: all required fields
    if (!walletId) errors.wallet = "Wallet is required";
    if (!tokenId) errors.token = "Token is required";
    if (!dateLocal) errors.dateLocal = "Date & Time is required";

    const amountError = validateAmount(amount);
    if (amountError) errors.amount = amountError;

    const priceError = validatePriceUsd(priceUsd, type);
    if (priceError) errors.priceUsd = priceError;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setGeneralError(null);
    setSubmitting(true);

    try {
      const priceToSend: string | null =
        !isPriceRequired(type) && priceUsd.trim() === "" ? null : priceUsd;

      const result = await submit(
        {
          walletId,
          tokenId,
          type,
          amount,
          priceUsd: priceToSend,
          dateLocal,
          costSource,
        },
        tokens ?? [],
      );

      if (result.status === "success") {
        showToast(
          `Transaction added. Cycle #${result.cycleNumber} updated.`,
          "success",
        );
        void navigate(`/token/${result.tokenContractAddress}/${result.tokenNetwork}`);
      } else {
        if (Object.keys(result.fieldErrors).length > 0) {
          setFieldErrors(result.fieldErrors);
        } else {
          setGeneralError(result.errorMessage);
        }

        if (result.errorCode === "INSUFFICIENT_BALANCE" && result.currentBalance !== undefined) {
          setGeneralError(`Exceeds balance of ${result.currentBalance} tokens`);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleUseInheritedWac(wac: string) {
    setPriceUsd(wac);
    setCostSource("INHERITED");
  }

  function handlePriceChange(value: string) {
    setPriceUsd(value);
    if (costSource === "INHERITED") {
      setCostSource("MANUAL");
    }
    // Clear price error when user types
    if (fieldErrors.priceUsd) {
      setFieldErrors((prev) => ({ ...prev, priceUsd: undefined }));
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 p-6 text-white">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-gray-400 hover:text-white"
            data-testid="cancel"
          >
            ← Cancel
          </button>
          <h1 className="text-2xl font-semibold">Add Transaction</h1>
        </div>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          noValidate
          className="flex flex-col gap-4 rounded-xl bg-gray-900 p-6"
        >
          {/* Wallet / Source */}
          <div>
            <WalletSourceSelect
              wallets={wallets ?? []}
              selectedWalletId={walletId}
              onChange={(id) => {
                setWalletId(id);
                setTokenId(""); // reset token when wallet changes
                setFieldErrors((prev) => ({ ...prev, wallet: undefined }));
              }}
            />
            {fieldErrors.wallet && (
              <p className="mt-1 text-sm text-red-400" role="alert">
                {fieldErrors.wallet}
              </p>
            )}
          </div>

          {/* Token */}
          <div>
            <TokenSelect
              tokens={tokens ?? null}
              selectedTokenId={tokenId}
              onChange={(id) => {
                setTokenId(id);
                setFieldErrors((prev) => ({ ...prev, token: undefined }));
              }}
            />
            {fieldErrors.token && (
              <p className="mt-1 text-sm text-red-400" role="alert">
                {fieldErrors.token}
              </p>
            )}
          </div>

          {/* Transaction Type */}
          <TransactionTypeSelect
            value={type}
            onChange={(t) => {
              setType(t);
              setFieldErrors({});
            }}
          />

          {/* Date & Time */}
          <div>
            <DateTimeInput value={dateLocal} onChange={setDateLocal} />
            {fieldErrors.dateLocal && (
              <p className="mt-1 text-sm text-red-400" role="alert">
                {fieldErrors.dateLocal}
              </p>
            )}
          </div>

          {/* Amount */}
          <AmountInput
            value={amount}
            onChange={(v) => {
              setAmount(v);
              setFieldErrors((prev) => ({ ...prev, amount: undefined }));
            }}
            currentBalance={currentBalance}
            type={type}
            fieldError={fieldErrors.amount ?? null}
          />

          {/* TRANSFER_IN inheritance suggestion */}
          {type === "TRANSFER_IN" && (
            <InheritWacSuggestion
              candidate={inheritCandidate}
              loading={inheritLoading}
              onUse={handleUseInheritedWac}
            />
          )}

          {/* Price USD */}
          <PriceUsdInput
            value={priceUsd}
            onChange={handlePriceChange}
            type={type}
            fieldError={fieldErrors.priceUsd ?? null}
          />

          {/* WAC Preview */}
          <WacPreview
            currentBalance={currentBalance}
            currentWac={currentWac}
            type={type}
            amount={amount}
            priceUsd={priceUsd}
          />

          {/* Submit Bar */}
          <SubmitBar
            submitting={submitting}
            disabled={isSubmitDisabled}
            errorMessage={generalError}
          />
        </form>
      </div>
    </main>
  );
}
