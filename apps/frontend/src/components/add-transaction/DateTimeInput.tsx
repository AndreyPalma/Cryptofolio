/**
 * DateTimeInput — controlled wrapper for <input type="datetime-local">.
 */
interface DateTimeInputProps {
  value: string; // YYYY-MM-DDTHH:mm
  onChange: (value: string) => void;
}

export function DateTimeInput({ value, onChange }: DateTimeInputProps) {
  return (
    <div>
      <label htmlFor="block-timestamp" className="mb-1 block text-sm text-gray-400">
        Date &amp; Time
      </label>
      <input
        id="block-timestamp"
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
      />
    </div>
  );
}
