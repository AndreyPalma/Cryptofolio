/**
 * useCreateTransaction — wraps POST /api/transactions.
 * Returns an action-compatible submit function.
 */
import { apiClient } from "../lib/api-client";
import { toIso8601 } from "../lib/iso-datetime";
import type { TransactionType, CostSource } from "../types/token-detail";
import type { DecimalString } from "../types/portfolio";
import type { Token } from "./useTokensByWallet";

export interface SubmitInput {
  walletId: string;
  tokenId: string;
  type: TransactionType;
  amount: string;
  priceUsd: string | null;
  dateLocal: string;
  costSource: "MANUAL" | "INHERITED";
}

export type SubmitResult =
  | {
      status: "success";
      transactionId: string;
      cycleNumber: number;
      tokenContractAddress: string;
      tokenNetwork: string;
    }
  | {
      status: "error";
      errorCode: string;
      errorMessage: string;
      fieldErrors: Record<string, string>;
      currentBalance?: DecimalString;
    };

interface CreateTransactionResponse {
  transaction_id: string;
  position_id: string;
  cycle_number: number;
  status: "OPEN" | "CLOSED";
  wac: string;
  balance: string;
}

interface ApiErrorBody {
  error?: string;
  message?: string;
  issues?: Array<{ path: string[]; message: string }>;
  currentBalance?: string;
  attempted?: string;
}

// We need to fetch with manual response handling for 4xx bodies
const BASE_URL = (typeof import.meta !== "undefined" && (import.meta.env as Record<string, string | undefined>)["VITE_API_URL"]) ?? "";

async function postTransaction(body: unknown): Promise<Response> {
  return fetch(`${BASE_URL}/api/transactions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function useCreateTransaction(): {
  submit: (input: SubmitInput, tokens: Token[]) => Promise<SubmitResult>;
} {
  async function submit(input: SubmitInput, tokens: Token[]): Promise<SubmitResult> {
    const token = tokens.find((t) => t.id === input.tokenId);

    const body = {
      wallet_id: input.walletId,
      token_id: input.tokenId,
      type: input.type,
      amount: input.amount,
      price_usd_at_time: input.priceUsd,
      block_timestamp: toIso8601(input.dateLocal),
      cost_source: input.costSource,
    };

    try {
      // Use apiClient for the happy path
      const res = await apiClient.post<CreateTransactionResponse>(
        "/api/transactions",
        body,
      );

      return {
        status: "success",
        transactionId: res.transaction_id,
        cycleNumber: res.cycle_number,
        tokenContractAddress: token?.contractAddress ?? "",
        tokenNetwork: token?.network ?? "",
      };
    } catch (err) {
      // Parse error response body for structured errors
      try {
        const response = await postTransaction(body);
        const text = await response.text();
        const errorBody = JSON.parse(text) as ApiErrorBody;

        if (errorBody.error === "INSUFFICIENT_BALANCE") {
          return {
            status: "error",
            errorCode: "INSUFFICIENT_BALANCE",
            errorMessage: `Exceeds balance of ${errorBody.currentBalance ?? "?"} tokens`,
            fieldErrors: {},
            currentBalance: errorBody.currentBalance,
          };
        }

        if (errorBody.message === "Validation failed" && errorBody.issues) {
          const fieldErrors: Record<string, string> = {};
          for (const issue of errorBody.issues) {
            const field = issue.path[0];
            if (field !== undefined) {
              fieldErrors[field] = issue.message;
            }
          }
          return {
            status: "error",
            errorCode: "VALIDATION_FAILED",
            errorMessage: "Validation failed",
            fieldErrors,
          };
        }

        if (errorBody.message === "PRICE_REQUIRED_FOR_TRANSFER_IN") {
          return {
            status: "error",
            errorCode: "PRICE_REQUIRED_FOR_TRANSFER_IN",
            errorMessage: "Price required for TRANSFER_IN",
            fieldErrors: { priceUsd: "Price required for TRANSFER_IN" },
          };
        }
      } catch {
        // Could not parse error body — fall through to generic
      }

      return {
        status: "error",
        errorCode: "UNKNOWN",
        errorMessage: "Could not save transaction. Try again.",
        fieldErrors: {},
      };
    }
  }

  return { submit };
}
