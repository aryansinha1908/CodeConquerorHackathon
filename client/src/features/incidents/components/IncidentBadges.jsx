import React from 'react';
import { Badge } from '../../../components/ui/Badge';
import { incidentStatusView, severityView, typeLabel } from './incidentView';

// An incident's status, severity and type as colour + icon + text (frontend.md §1 principle 2, §10.2).
// Other props go to Badge (size, className, …).

export function IncidentStatusBadge({ status, size = 'md', ...props }) {
  const view = incidentStatusView(status);
  return (
    <Badge variant={view.variant} icon={view.icon ?? undefined} size={size} {...props}>
      {view.label}
    </Badge>
  );
}

export function SeverityBadge({ severity, size = 'md', ...props }) {
  const view = severityView(severity);
  return (
    <Badge variant={view.variant} icon={view.icon ?? undefined} size={size} {...props}>
      {view.label}
    </Badge>
  );
}

export function TypeBadge({ type, size = 'md', ...props }) {
  return (
    <Badge variant="outline" size={size} {...props}>
      {typeLabel(type)}
    </Badge>
  );
}
