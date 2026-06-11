import { ArrowLeft, FileQuestion } from "lucide-react";

interface ErrorScreenProps {
  code: 404 | 403 | 500;
  onGoBack: () => void;
}

export default function ErrorScreen({ code, onGoBack }: ErrorScreenProps) {
  const copy =
    code === 404
      ? [
          "We could not find that file.",
          "The link may have expired or the file may have moved.",
        ]
      : code === 403
        ? [
            "This file is not available to you.",
            "Ask the owner for a new link or different access.",
          ]
        : ["Something did not load.", "Try again in a moment."];
  return (
    <div className="grid min-h-[70vh] place-items-center px-5">
      <div className="max-w-md text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#eef1f5]">
          <FileQuestion className="h-5 w-5" />
        </div>
        <p className="mt-5 text-sm text-[#8a9099]">{code}</p>
        <h1 className="mt-2 text-2xl font-semibold">{copy[0]}</h1>
        <p className="mt-2 text-sm leading-6 text-[#7d838c]">{copy[1]}</p>
        <button
          onClick={onGoBack}
          className="mx-auto mt-6 flex items-center gap-2 rounded-lg border border-[#d9dde3] bg-white px-4 py-2.5 text-sm font-medium"
        >
          <ArrowLeft className="h-4 w-4" />
          Go back
        </button>
      </div>
    </div>
  );
}
