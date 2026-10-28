import { Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";

import { useStore, type WorkflowStage } from "store";
import { coverageUnitId } from "store/review";

import { ApprovalFrame } from "./ApprovalFrame";
import ApprovalMark from "./ApprovalMark";

/**
 * One coverage approval per upstream item: the items of this stage that
 * reference it cover it fully. Approving every item cannot say that
 * nothing is missing; this is where a reviewer says it.
 */
const CoveragePanel = observer(function CoveragePanel({ step }: { step: WorkflowStage }) {
  const store = useStore();
  const parentIds = store.coverageParentIds(step);
  if (parentIds.length === 0 || !store.hasStepArtifacts(step)) return null;
  return (
    <Stack sx={{ gap: 1, mt: 3 }}>
      <Typography variant="h6" component="h4">
        Coverage
      </Typography>
      {parentIds.map((parentId) => {
        const unitId = coverageUnitId(parentId);
        const parentCode = store.getCode(parentId) ?? parentId;
        const parentText = store.structuralFragmentsCache[parentId]?.content ?? "";
        const children = store.coverageChildIds(parentId).map((id) => store.getCode(id) ?? id);
        return (
          <ApprovalFrame
            key={unitId}
            elementId={unitId}
            approval={store.approvalOf(unitId)}
            sx={{ borderRadius: 1, bgcolor: "background.paper", pl: 3, pr: 1, py: 1 }}
          >
            <Stack direction="row" sx={{ alignItems: "center", gap: 2 }}>
              <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="body2">
                  <strong>{parentCode}.</strong> {parentText}
                </Typography>
                <Typography variant="caption" color={children.length === 0 ? "error" : "text.secondary"}>
                  {children.length === 0 ? "Nothing covers it yet." : `Covered by ${children.join(", ")}`}
                </Typography>
              </Stack>
              <ApprovalMark id={unitId} />
            </Stack>
          </ApprovalFrame>
        );
      })}
    </Stack>
  );
});

export default CoveragePanel;
