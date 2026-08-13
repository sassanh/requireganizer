import { Alert, Stack, Typography } from "@mui/material";

const CodePlaceholder = () => (
  <Stack spacing={2} sx={{ py: 8, alignItems: "center" }}>
    <Typography variant="h5">Application implementation is a future stage</Typography>
    <Alert severity="info">
      Scaffold and automated-test generation do not implement the product, so Code intentionally remains pending.
    </Alert>
  </Stack>
);

export default CodePlaceholder;
