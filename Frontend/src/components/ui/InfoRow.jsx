import React from 'react';

// Label/value row for <dl> summaries (patient data, case participants).
const InfoRow = ({ label, children }) => (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
        <dt className="text-slate-500">{label}</dt>
        <dd className="text-right font-medium text-slate-900">{children}</dd>
    </div>
);

export default InfoRow;
