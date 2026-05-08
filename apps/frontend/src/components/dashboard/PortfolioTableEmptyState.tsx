import { Link } from "react-router-dom";

export function PortfolioTableEmptyState() {
  return (
    <div className="mt-8 flex flex-col items-center justify-center rounded-lg bg-gray-900 p-12 text-center">
      <p className="mb-4 text-gray-400">
        Add your first wallet in Settings to start tracking your portfolio.
      </p>
      <Link
        to="/settings"
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Go to Settings
      </Link>
    </div>
  );
}
