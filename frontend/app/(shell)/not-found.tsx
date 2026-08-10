import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFoundInShell() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 space-y-4">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <FileQuestion className="w-8 h-8" />
          </div>
        </div>
        <h1 className="text-xl font-bold text-slate-800">Page Not Found</h1>
        <p className="text-sm text-slate-500">
          The page or resource you are trying to reach does not exist, has been relocated, or is restricted.
        </p>
        <Link
          href="/dashboard"
          className="inline-block mt-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-extrabold shadow-sm hover:bg-emerald-700 transition-all"
        >
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
