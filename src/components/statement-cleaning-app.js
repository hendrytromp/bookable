"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { downloadBackendMultipart, requestBackendMultipart } from "@/lib/api";

const bankOptions = [
  { value: "aruba-bank", label: "Aruba Bank", enabled: true },
  { value: "cmb", label: "CMB", enabled: false },
];

const defaultStatementPdfForm = {
  bank: "aruba-bank",
  removeAuthNoise: true,
  manualOpeningBalance: "",
};

function formatNumericCurrency(amount, currencyCode = "AWG") {
  if (typeof amount !== "number" || Number.isNaN(amount)) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(amount);
}

function StatCard({ label, value, subtitle }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.5,
        border: "1px solid rgba(20, 32, 51, 0.08)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,250,244,0.94))",
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" sx={{ mt: 0.5 }}>
        {value}
      </Typography>
      {subtitle ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {subtitle}
        </Typography>
      ) : null}
    </Paper>
  );
}

function buildLifecycleLabel(item) {
  const lifecycle = item?.transactionLifecycle || "posted";

  if (lifecycle === "authorization") return "Authorization";
  if (lifecycle === "authorization-release") return "Auth release";
  if (lifecycle === "reversal") return "Reversal";
  if (lifecycle === "hold") return "Hold";
  if (lifecycle === "hold-release") return "Hold release";

  return "Posted";
}

function buildLifecycleColor(item) {
  const lifecycle = item?.transactionLifecycle || "posted";

  if (lifecycle === "posted") {
    return item?.isDebit === true ? "error" : "success";
  }

  if (lifecycle === "authorization" || lifecycle === "hold") {
    return "warning";
  }

  return "default";
}

export default function StatementCleaningApp() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [statementPdfFile, setStatementPdfFile] = useState(null);
  const [statementPdfForm, setStatementPdfForm] = useState(defaultStatementPdfForm);
  const [statementPayload, setStatementPayload] = useState(null);

  async function handleStatementPdfParse(event) {
    event.preventDefault();

    if (!statementPdfFile) {
      setError("Select a PDF statement file first.");
      return;
    }

    if (statementPdfForm.bank !== "aruba-bank") {
      setError("CMB is coming soon. Choose Aruba Bank to continue.");
      return;
    }

    setPending(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", statementPdfFile);
      formData.append("removeAuthNoise", String(statementPdfForm.removeAuthNoise));

      const payload = await requestBackendMultipart("parse", {
        method: "POST",
        formData,
      });

      setStatementPayload(payload);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setPending(false);
    }
  }

  async function handleStatementPdfDownload() {
    if (!statementPdfFile) {
      setError("Select a PDF statement file first.");
      return;
    }

    if (statementPdfForm.bank !== "aruba-bank") {
      setError("CMB is coming soon. Choose Aruba Bank to continue.");
      return;
    }

    setPending(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", statementPdfFile);
      formData.append("removeAuthNoise", String(statementPdfForm.removeAuthNoise));

      const { blob, filename } = await downloadBackendMultipart("export-csv", {
        method: "POST",
        formData,
      });

      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename || `${statementPdfFile.name.replace(/\.pdf$/i, "") || "statement"}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setPending(false);
    }
  }

  const items = Array.isArray(statementPayload?.items) ? statementPayload.items : [];
  const parsedOpeningBalance = statementPayload?.balanceForward?.amount ?? null;
  const parsedEndingBalance = statementPayload?.endingBalance?.amount ?? null;
  const manualOpeningBalance = statementPdfForm.manualOpeningBalance === "" ? null : Number(statementPdfForm.manualOpeningBalance);
  const effectiveOpeningBalance = Number.isFinite(manualOpeningBalance) ? manualOpeningBalance : parsedOpeningBalance;
  const totalsFromItems = items.reduce(
    (totals, item) => {
      const amount = typeof item?.amountCurrency?.amount === "number" ? item.amountCurrency.amount : 0;
      if (item?.isDebit === true) {
        totals.debit += amount;
      } else if (item?.isDebit === false) {
        totals.credit += amount;
      }
      if (typeof item?.signedAmount === "number") {
        totals.net += item.signedAmount;
      }
      return totals;
    },
    { debit: 0, credit: 0, net: 0 }
  );
  const debitTotal = typeof statementPayload?.rawDebitTotal === "number" ? statementPayload.rawDebitTotal : +totalsFromItems.debit.toFixed(2);
  const creditTotal = typeof statementPayload?.rawCreditTotal === "number" ? statementPayload.rawCreditTotal : +totalsFromItems.credit.toFixed(2);
  const netMovement = typeof statementPayload?.rawNetMovement === "number" ? statementPayload.rawNetMovement : +totalsFromItems.net.toFixed(2);
  const calculatedEndingBalance = typeof effectiveOpeningBalance === "number" ? +(effectiveOpeningBalance + netMovement).toFixed(2) : null;
  const balanceCurrency = statementPayload?.balanceForward?.currencyCode || statementPayload?.endingBalance?.currencyCode || "AWG";
  const debitCreditNet = +((creditTotal || 0) - (debitTotal || 0)).toFixed(2);
  const netMovementMatches = Math.abs(debitCreditNet - netMovement) <= 0.01;
  const endingBalanceMatches = parsedEndingBalance != null && calculatedEndingBalance != null && Math.abs(parsedEndingBalance - calculatedEndingBalance) <= 0.01;
  const statementMatch = netMovementMatches && (parsedEndingBalance == null || endingBalanceMatches);
  const rawItemCount = statementPayload?.rawItemCount ?? items.length;
  const filteredItemCount = statementPayload?.filteredItemCount ?? items.length;
  const rawNonBookableCount = statementPayload?.rawNonBookableCount ?? Math.max(0, rawItemCount - filteredItemCount);
  const filteredBookableCount = statementPayload?.filteredBookableCount ?? items.filter((item) => item?.bookable !== false).length;
  const visibleNonBookableCount = Math.max(0, filteredItemCount - filteredBookableCount);
  const bookingCleanupReady = statementPdfForm.removeAuthNoise && visibleNonBookableCount === 0;

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, rgba(255,244,228,0.92), rgba(239,246,250,0.9) 42%, rgba(232,239,244,0.96) 100%)",
        py: { xs: 4, md: 6 },
      }}
    >
      <Container maxWidth="xl">
        <Stack spacing={3}>
          <Paper
            elevation={0}
            sx={{
              p: { xs: 3, md: 4 },
              borderRadius: 6,
              border: "1px solid rgba(20, 32, 51, 0.08)",
              background: "linear-gradient(135deg, rgba(255,255,255,0.84), rgba(255,247,239,0.92))",
            }}
          >
            <Stack spacing={2}>
              <Chip label="PDF Extract Only" color="secondary" sx={{ width: "fit-content" }} />
              <Typography variant="h2" sx={{ fontSize: { xs: "2.5rem", md: "4rem" }, lineHeight: 0.95, maxWidth: 900 }}>
                Clean statement PDFs into bookable rows.
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 820, fontSize: "1.05rem" }}>
                Upload a statement PDF, reconcile the full statement math, remove authorization and reversal noise, and export a cleaner CSV. No bank API connection is used here.
              </Typography>
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 3, border: "1px solid rgba(20, 32, 51, 0.08)" }}>
            <Stack component="form" spacing={2} onSubmit={handleStatementPdfParse}>
              <Grid container spacing={2} alignItems="start">
                <Grid item xs={12} md={4}>
                  <TextField
                    select
                    label="Bank"
                    value={statementPdfForm.bank}
                    onChange={(event) =>
                      setStatementPdfForm((current) => ({
                        ...current,
                        bank: event.target.value,
                      }))
                    }
                    fullWidth
                  >
                    {bankOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value} disabled={!option.enabled}>
                        {option.label}{!option.enabled ? " (coming soon)" : ""}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    label="Manual opening balance override"
                    type="number"
                    value={statementPdfForm.manualOpeningBalance}
                    onChange={(event) =>
                      setStatementPdfForm((current) => ({
                        ...current,
                        manualOpeningBalance: event.target.value,
                      }))
                    }
                    inputProps={{ step: "0.01" }}
                    helperText="Optional. Leave blank to use the PDF Balance Forward value."
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ pt: { md: 3.5 } }}>
                    <Chip
                      label={statementPdfForm.removeAuthNoise ? "Auth filter on" : "Auth filter off"}
                      color={statementPdfForm.removeAuthNoise ? "primary" : "default"}
                      variant={statementPdfForm.removeAuthNoise ? "filled" : "outlined"}
                      onClick={() =>
                        setStatementPdfForm((current) => ({
                          ...current,
                          removeAuthNoise: !current.removeAuthNoise,
                        }))
                      }
                    />
                  </Stack>
                </Grid>
              </Grid>

              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
                <Button component="label" variant="outlined" disabled={pending || statementPdfForm.bank !== "aruba-bank"}>
                  Choose PDF file
                  <input
                    hidden
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(event) => setStatementPdfFile(event.target.files?.[0] || null)}
                  />
                </Button>
                <Typography variant="body2" color="text.secondary">
                  {statementPdfFile ? statementPdfFile.name : "No PDF selected yet."}
                </Typography>
              </Stack>

              {error ? <Alert severity="error">{error}</Alert> : null}

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <Button type="submit" variant="contained" disabled={pending || !statementPdfFile || statementPdfForm.bank !== "aruba-bank"}>
                  {pending ? "Parsing..." : "Parse PDF statement"}
                </Button>
                <Button type="button" variant="outlined" disabled={pending || !statementPdfFile || statementPdfForm.bank !== "aruba-bank"} onClick={handleStatementPdfDownload}>
                  Download cleaned CSV
                </Button>
              </Stack>
            </Stack>
          </Paper>

          {statementPayload ? (
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <StatCard label="Parsed rows" value={rawItemCount} />
              </Grid>
              <Grid item xs={12} md={3}>
                <StatCard label="Filtered rows" value={filteredItemCount} />
              </Grid>
              <Grid item xs={12} md={3}>
                <StatCard
                  label="Opening balance"
                  value={formatNumericCurrency(effectiveOpeningBalance, balanceCurrency) || "-"}
                  subtitle={Number.isFinite(manualOpeningBalance) ? "Manual override" : "Parsed from Balance Forward"}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <StatCard
                  label="Ending balance"
                  value={formatNumericCurrency(calculatedEndingBalance, balanceCurrency) || "-"}
                  subtitle={parsedEndingBalance != null ? `PDF ending ${formatNumericCurrency(parsedEndingBalance, balanceCurrency)}` : "Calculated from full statement movement"}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <StatCard label="Debit total" value={formatNumericCurrency(debitTotal, balanceCurrency) || "-"} subtitle="Full parsed rows" />
              </Grid>
              <Grid item xs={12} md={3}>
                <StatCard label="Credit total" value={formatNumericCurrency(creditTotal, balanceCurrency) || "-"} subtitle="Full parsed rows" />
              </Grid>
              <Grid item xs={12} md={3}>
                <StatCard label="Net movement" value={formatNumericCurrency(netMovement, balanceCurrency) || "-"} subtitle="Credits minus debits" />
              </Grid>
              <Grid item xs={12} md={3}>
                <StatCard label="Removed non-bookable" value={rawNonBookableCount} subtitle="Authorization, reversal, and hold rows" />
              </Grid>
            </Grid>
          ) : null}

          {statementPayload ? (
            <Alert severity={statementMatch ? "success" : "warning"}>
              Statement reconciliation: debit/credit to net is {netMovementMatches ? "matched" : "not matched"}
              {" ("}
              {formatNumericCurrency(creditTotal, balanceCurrency) || creditTotal}
              {" - "}
              {formatNumericCurrency(debitTotal, balanceCurrency) || debitTotal}
              {" = "}
              {formatNumericCurrency(debitCreditNet, balanceCurrency) || debitCreditNet}
              {"). "}
              opening to ending is {parsedEndingBalance == null ? "not available" : endingBalanceMatches ? "matched" : "not matched"}
              {parsedEndingBalance != null && calculatedEndingBalance != null
                ? ` (${formatNumericCurrency(effectiveOpeningBalance, balanceCurrency) || effectiveOpeningBalance} + ${formatNumericCurrency(netMovement, balanceCurrency) || netMovement} = ${formatNumericCurrency(calculatedEndingBalance, balanceCurrency) || calculatedEndingBalance}, PDF ending ${formatNumericCurrency(parsedEndingBalance, balanceCurrency) || parsedEndingBalance}).`
                : "."}
            </Alert>
          ) : null}

          {statementPayload ? (
            <Alert severity={!statementPdfForm.removeAuthNoise ? "info" : bookingCleanupReady ? "success" : "warning"}>
              Booking cleanup: {!statementPdfForm.removeAuthNoise
                ? "auth filter is off, so the visible table may still include authorization and reversal rows."
                : bookingCleanupReady
                  ? `ready for booking. Removed ${rawNonBookableCount} non-bookable rows and left ${filteredBookableCount} visible bookable rows.`
                  : `needs review. ${visibleNonBookableCount} non-bookable rows are still visible in the filtered result.`}
            </Alert>
          ) : null}

          <Paper elevation={0} sx={{ overflow: "hidden", border: "1px solid rgba(20, 32, 51, 0.08)" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Lifecycle</TableCell>
                  <TableCell>Bookable</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.length ? (
                  items.map((item, index) => (
                    <TableRow key={item.transactionDetailRefId || item.referenceNumber || `${item.transactionDate}-${index}`}>
                      <TableCell>{item.transactionDate || item.valueDate || "-"}</TableCell>
                      <TableCell>{item.description || item.counterpartyName || "-"}</TableCell>
                      <TableCell>
                        <Chip size="small" label={buildLifecycleLabel(item)} color={buildLifecycleColor(item)} variant="filled" />
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={item?.bookable === false ? "No" : "Yes"}
                          color={item?.bookable === false ? "default" : "success"}
                          variant={item?.bookable === false ? "outlined" : "filled"}
                        />
                      </TableCell>
                      <TableCell align="right">{item.amountCurrency?.amount ?? item.amount ?? "-"}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5}>
                      {statementPayload ? "No statement transactions were extracted from the uploaded PDF." : "Upload a PDF statement and parse it to preview cleaned transactions."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}
