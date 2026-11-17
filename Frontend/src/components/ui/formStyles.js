// Shared class strings for forms. Brand primary is blue-900 (TecNM).

export const labelClass = 'block text-sm font-medium text-slate-700';

export const helpClass = 'mt-1 text-xs text-slate-500';

export const errorClass = 'mt-1 text-xs font-medium text-red-700';

export const inputClass = (hasError = false) =>
    'mt-1 block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 '
    + 'transition-[border-color,box-shadow] duration-150 focus:outline-none focus:ring-4 '
    + 'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 '
    + (hasError
        ? 'border-red-500 focus:border-red-600 focus:ring-red-600/15'
        : 'border-slate-300 focus:border-blue-900 focus:ring-blue-900/15');

export const primaryButton =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white '
    + 'transition-[background-color,scale] duration-150 ease-out hover:bg-blue-800 enabled:active:scale-[0.96] '
    + 'focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-900/30 '
    + 'disabled:cursor-not-allowed disabled:bg-blue-900/60 motion-reduce:transition-none';

export const secondaryButton =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 '
    + 'transition-[background-color,scale] duration-150 ease-out hover:bg-slate-50 enabled:active:scale-[0.96] '
    + 'focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-400/30 '
    + 'disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none';
