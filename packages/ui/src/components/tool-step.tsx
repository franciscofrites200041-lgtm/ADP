import type { ReactNode } from "react";

import { FlowConnector } from "./flow-connector.tsx";
import { FlowNode } from "./flow-node.tsx";

interface ToolStepProps {
  icon?: ReactNode;
  children: ReactNode;
}

/** A tool call rendered as a node joined to the previous step by a connector. */
export function ToolStep({ icon, children }: ToolStepProps) {
  return (
    <div>
      <FlowConnector />
      <FlowNode>
        {icon}
        {children}
      </FlowNode>
    </div>
  );
}
