export function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 11 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="animate-pulse h-4 rounded bg-gray-800" />
        </td>
      ))}
    </tr>
  );
}
