import { useState } from "react";
import { apiClient } from "../../lib/api-client";

interface CreateOnChainInput {
  wallet_type: "ON_CHAIN";
  address: string;
  network: "ETH" | "BSC";
  label?: string;
}

interface CreateCexInput {
  wallet_type: "CEX";
  network: "CEX_BINANCE";
  label?: string;
}

export function useWalletMutations() {
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const addWallet = async (input: CreateOnChainInput | CreateCexInput): Promise<void> => {
    setAdding(true);
    setAddError(null);
    try {
      await apiClient.post("/api/wallets", input);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to add wallet";
      setAddError(msg);
      throw e;
    } finally {
      setAdding(false);
    }
  };

  const deleteWallet = async (id: string): Promise<void> => {
    setDeleting(id);
    try {
      await apiClient.delete(`/api/wallets/${id}`);
    } catch (e) {
      throw e;
    } finally {
      setDeleting(null);
    }
  };

  return { addWallet, deleteWallet, adding, deleting, addError, clearAddError: () => setAddError(null) };
}
