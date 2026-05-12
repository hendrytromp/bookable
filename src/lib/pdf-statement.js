import pdfParse from "pdf-parse/lib/pdf-parse.js";

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseStatementAmount(rawValue) {
  const normalizedValue = normalizeWhitespace(rawValue).replace(/,/g, "");
  if (!normalizedValue) {
    return null;
  }

  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function extractAmountValue(item) {
  const candidate =
    item?.amountCurrency?.amount ??
    item?.amount?.amount ??
    item?.amount ??
    item?.transactionAmount?.amount ??
    item?.transactionAmount ??
    item?.creditAmount ??
    item?.debitAmount ??
    null;

  const numericValue = typeof candidate === "number" ? candidate : Number(String(candidate ?? "").replace(/,/g, ""));
  return Number.isFinite(numericValue) ? Math.abs(numericValue) : null;
}

function extractCurrencyCode(item) {
  return (
    item?.amountCurrency?.currencyCode ||
    item?.amount?.currencyCode ||
    item?.transactionAmount?.currencyCode ||
    item?.currencyCode ||
    "AWG"
  );
}

function buildSignedAmount(item) {
  const amount = extractAmountValue(item);
  if (amount === null) {
    return null;
  }

  return item?.isDebit === true ? -amount : amount;
}

function cleanTransactionDescription(rawDescription) {
  let value = normalizeWhitespace(rawDescription);

  if (!value) {
    return "";
  }

  value = value.replace(/\b(?:\d{4,}[A-Z0-9-]*\s+){2,}/g, "");
  value = value.replace(/^\d{4,}\s+/, "");
  value = value.replace(/^(MAESTRO\/POS|POS|ATM|ONLINE|TRANSFER|MCDEBIT-AUTHORIZATION REQUEST HOLD|MCDEBIT-AUTHORIZATI(?:ON)?|DB AB SALE)\s*-?\s*/i, "");
  value = value.replace(/\b[NEWS]\s+(?:ORANJESTAD|SAVANETA|NOORD|STA\s+CRUZ|SAN\s+NICOLAS|PARADERA)\s+AW\b.*$/i, "");
  value = value.replace(/\b(?:ORANJESTAD|SAVANETA|NOORD|STA\s+CRUZ|SANTA\s+CRUZ|SAN\s+NICOLAS|PARADERA|WILLEMSTAD|CURACAO|LUXEMBOURG|MOUNTAIN\s+VIEW|LONDON)\b.*$/i, "");
  value = value.replace(/\b(?:AW|US|GB|LU|CW)\b$/i, "");
  value = normalizeWhitespace(value);

  return value || normalizeWhitespace(rawDescription);
}

function looksLikeAuthorizationNoise(item) {
  if (item?.bookable === false) {
    return true;
  }

  if (item?.transactionLifecycle && item.transactionLifecycle !== "posted") {
    return true;
  }

  const description = normalizeWhitespace(item?.description || item?.counterpartyName || "").toUpperCase();
  const valueDate = String(item?.valueDate || "").trim();

  return (
    valueDate === "99/99/99" ||
    valueDate === "99/99/1999" ||
    /AUTHORIZATION REQUEST HOLD/.test(description) ||
    /MCDEBIT-AUTHORIZAT/.test(description) ||
    /\bREV\b/.test(description)
  );
}

function classifyTransactionLifecycle(item) {
  const description = normalizeWhitespace([
    item?.statementRowText,
    item?.originalDescription,
    item?.description,
    item?.counterpartyName,
  ].filter(Boolean).join(" ")).toUpperCase();
  const valueDate = String(item?.valueDate || "").trim();

  if (valueDate === "99/99/99" || valueDate === "99/99/1999") {
    if (/\bREV\b/.test(description)) {
      return "reversal";
    }

    if (/AUTHORIZATION REQUEST HOLD/.test(description)) {
      return "hold-release";
    }

    if (/MCDEBIT-AUTHORIZAT/.test(description)) {
      return "authorization-release";
    }
  }

  if (/AUTHORIZATION REQUEST HOLD/.test(description)) {
    return "hold";
  }

  if (/MCDEBIT-AUTHORIZAT/.test(description)) {
    return /\bREV\b/.test(description) ? "reversal" : "authorization";
  }

  return "posted";
}

function csvEscape(value) {
  const stringValue = value == null ? "" : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

export function toCsv(rows, headers) {
  const lines = [headers.join(",")];

  rows.forEach((row) => {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","));
  });

  return lines.join("\n");
}

function getTransactionItems(payload) {
  return Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
}

function normalizeTransactionItem(item) {
  const originalDescription = normalizeWhitespace(item?.description || item?.counterpartyName || "");
  const cleanDescription = cleanTransactionDescription(originalDescription) || originalDescription;
  const signedAmount = buildSignedAmount(item);
  const transactionLifecycle = item?.transactionLifecycle || classifyTransactionLifecycle(item);

  return {
    ...item,
    originalDescription,
    description: cleanDescription,
    signedAmount,
    transactionLifecycle,
    bookable: typeof item?.bookable === "boolean" ? item.bookable : transactionLifecycle === "posted",
  };
}

function parseComparableDate(rawValue) {
  const value = String(rawValue || "").trim();
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    return null;
  }

  const [, month, day, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildMerchantMatchSignature(item) {
  const value = normalizeWhitespace(item?.originalDescription || item?.description || "")
    .replace(/^[A-Z]{3}\s+\d[\d,.]*\s+/i, "")
    .replace(/^(MAESTRO\/POS|POS|MCDEBIT-AUTHORIZATI(?:ON)?|MCDEBIT-AUTHORIZAT\s+REV|DB AB SALE|VS-MC SALE)\s+/i, "")
    .replace(/\b(?:AW|US|GB|LU|CW)\b$/i, "")
    .trim()
    .toUpperCase();

  return value;
}

function inferOpeningBalanceFromItems(items) {
  const firstBalancedItem = items.find(
    (item) => typeof item?.runningBalance === "number" && typeof item?.signedAmount === "number"
  );

  if (!firstBalancedItem) {
    return null;
  }

  return +(firstBalancedItem.runningBalance - firstBalancedItem.signedAmount).toFixed(2);
}

function inferEndingBalanceFromItems(items) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (typeof items[index]?.runningBalance === "number") {
      return +items[index].runningBalance.toFixed(2);
    }
  }

  return null;
}

function chooseReconciledBalances(payload, rawItems, rawNetMovement) {
  const inferredOpening = inferOpeningBalanceFromItems(rawItems);
  const inferredEnding = inferEndingBalanceFromItems(rawItems);
  const currencyCode = payload?.balanceForward?.currencyCode || payload?.endingBalance?.currencyCode || "AWG";
  const openingCandidates = [payload?.balanceForward?.amount, inferredOpening]
    .filter((amount) => typeof amount === "number")
    .map((amount) => +amount.toFixed(2));
  const endingCandidates = [payload?.endingBalance?.amount, inferredEnding]
    .filter((amount) => typeof amount === "number")
    .map((amount) => +amount.toFixed(2));

  if (!openingCandidates.length && !endingCandidates.length) {
    return payload;
  }

  if (!openingCandidates.length) {
    return {
      ...payload,
      endingBalance: typeof endingCandidates[0] === "number"
        ? { amount: endingCandidates[0], currencyCode }
        : payload?.endingBalance,
    };
  }

  if (!endingCandidates.length) {
    return {
      ...payload,
      balanceForward: typeof openingCandidates[0] === "number"
        ? { amount: openingCandidates[0], currencyCode }
        : payload?.balanceForward,
    };
  }

  let bestPair = null;

  openingCandidates.forEach((openingAmount) => {
    endingCandidates.forEach((endingAmount) => {
      const delta = Math.abs(+((openingAmount + rawNetMovement) - endingAmount).toFixed(2));
      if (!bestPair || delta < bestPair.delta) {
        bestPair = {
          openingAmount,
          endingAmount,
          delta,
        };
      }
    });
  });

  if (!bestPair) {
    return payload;
  }

  return {
    ...payload,
    balanceForward: {
      ...(payload?.balanceForward || {}),
      amount: bestPair.openingAmount,
      currencyCode,
    },
    endingBalance: {
      ...(payload?.endingBalance || {}),
      amount: bestPair.endingAmount,
      currencyCode,
    },
  };
}

function applyRelatedTransactionRules(items) {
  return items.map((item, index, allItems) => {
    const amount = item?.amountCurrency?.amount;
    if (
      item?.bookable !== true ||
      item?.isDebit !== true ||
      typeof amount !== "number" ||
      !/^[A-Z]{3}\s+\d[\d,.]*/i.test(item?.originalDescription || item?.description || "")
    ) {
      return item;
    }

    const currentDate = parseComparableDate(item?.transactionDate);
    const currentSignature = buildMerchantMatchSignature(item);
    if (!currentDate || !currentSignature) {
      return item;
    }

    const matchingPostedCharge = allItems.find((candidate, candidateIndex) => {
      if (candidateIndex === index || candidate?.isDebit !== true || candidate?.bookable !== true) {
        return false;
      }

      const candidateAmount = candidate?.amountCurrency?.amount;
      const candidateDate = parseComparableDate(candidate?.transactionDate);
      if (typeof candidateAmount !== "number" || !candidateDate) {
        return false;
      }

      const dayDelta = Math.round((candidateDate.getTime() - currentDate.getTime()) / 86400000);
      if (dayDelta < 0 || dayDelta > 5) {
        return false;
      }

      const amountDelta = +(candidateAmount - amount).toFixed(2);
      if (Math.abs(amountDelta) > 5) {
        return false;
      }

      return buildMerchantMatchSignature(candidate) === currentSignature;
    });

    if (!matchingPostedCharge) {
      return item;
    }

    return {
      ...item,
      transactionLifecycle: "authorization",
      bookable: false,
      matchedPostedDescription: matchingPostedCharge.description || "",
      matchedPostedAmount: matchingPostedCharge?.amountCurrency?.amount ?? null,
    };
  });
}

function buildFilteredSearchPayload(payload, options = {}) {
  const { removeAuthNoise = true } = options;
  const rawItems = applyRelatedTransactionRules(getTransactionItems(payload).map(normalizeTransactionItem));
  const items = rawItems
    .filter((item) => !(removeAuthNoise && looksLikeAuthorizationNoise(item)))
    .map(normalizeTransactionItem);

  const summarizeTotals = (transactionItems) => {
    const debitTotal = transactionItems.reduce(
      (total, item) => total + (item?.isDebit === true && typeof item?.amountCurrency?.amount === "number" ? item.amountCurrency.amount : 0),
      0
    );
    const creditTotal = transactionItems.reduce(
      (total, item) => total + (item?.isDebit === false && typeof item?.amountCurrency?.amount === "number" ? item.amountCurrency.amount : 0),
      0
    );
    const netMovement = transactionItems.reduce(
      (total, item) => total + (typeof item?.signedAmount === "number" ? item.signedAmount : 0),
      0
    );

    return {
      debitTotal: +debitTotal.toFixed(2),
      creditTotal: +creditTotal.toFixed(2),
      netMovement: +netMovement.toFixed(2),
    };
  };

  const rawTotals = summarizeTotals(rawItems);
  const filteredTotals = summarizeTotals(items);
  const reconciledPayload = chooseReconciledBalances(payload, rawItems, rawTotals.netMovement);
  const rawBookableCount = rawItems.filter((item) => item?.bookable !== false).length;
  const rawNonBookableCount = rawItems.length - rawBookableCount;
  const filteredBookableCount = items.filter((item) => item?.bookable !== false).length;

  if (Array.isArray(payload)) {
    return items;
  }

  return {
    ...(reconciledPayload || {}),
    items,
    rawItemCount: rawItems.length,
    filteredItemCount: items.length,
    rawBookableCount,
    rawNonBookableCount,
    filteredBookableCount,
    rawSignedMovement: rawTotals.netMovement,
    filteredSignedMovement: filteredTotals.netMovement,
    rawDebitTotal: rawTotals.debitTotal,
    rawCreditTotal: rawTotals.creditTotal,
    rawNetMovement: rawTotals.netMovement,
    filteredDebitTotal: filteredTotals.debitTotal,
    filteredCreditTotal: filteredTotals.creditTotal,
    filteredNetMovement: filteredTotals.netMovement,
  };
}

export function buildTransactionExportRows(payload, options = {}) {
  const { removeAuthNoise = true } = options;
  const items = getTransactionItems(payload)
    .filter((item) => !(removeAuthNoise && looksLikeAuthorizationNoise(item)))
    .map(normalizeTransactionItem);

  return items.map((item) => ({
    Date: item?.transactionDate || item?.bookingDate || item?.date || "",
    ValueDate: item?.valueDate || "",
    Description: item.description || "",
    OriginalDescription: item.originalDescription || "",
    Type: item?.isDebit === true ? "Debit" : "Credit",
    Reference: item?.referenceNumber || item?.transactionDetailRefId || item?.overviewId || item?.id || "",
    Amount: item.signedAmount == null ? "" : item.signedAmount.toFixed(2),
    Currency: extractCurrencyCode(item),
  }));
}

function expandStatementYear(twoDigitYear) {
  const year = Number(twoDigitYear);
  return year >= 70 ? 1900 + year : 2000 + year;
}

function normalizeStatementDate(rawValue) {
  const trimmedValue = String(rawValue || "").trim();
  const match = trimmedValue.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);

  if (!match) {
    return trimmedValue;
  }

  const [, month, day, yearSuffix] = match;
  return `${month}/${day}/${expandStatementYear(yearSuffix)}`;
}

function shouldIgnoreStatementLine(line) {
  const trimmedLine = line.trim();

  if (!trimmedLine) {
    return true;
  }

  return /^(Statement as of|Page\s*:|Currency\s*:|Type of account\s*:|Statement period\s*:|S T A T E M E N T|A C C O U N T|Account Number|Description\s+Balance|Xonix App Development VBA|Pos Abou 34 B|Oranjestad|ARUBA)$/i.test(trimmedLine);
}

function detectStatementColumns(line) {
  const valueDateStart = line.indexOf("Value Date");
  const descriptionStart = line.indexOf("Description");
  const debitsStart = line.indexOf("Debits");
  const creditsStart = line.indexOf("Credits");
  const balanceStart = line.lastIndexOf("Balance");

  if ([valueDateStart, descriptionStart, debitsStart, creditsStart, balanceStart].some((index) => index < 0)) {
    return null;
  }

  return {
    valueDateStart,
    descriptionStart,
    debitsStart,
    creditsStart,
    balanceStart,
  };
}

function extractStatementAmountsFromLine(line, columnIndexes) {
  const amountMatches = [...line.matchAll(/(?:^|\s)(\d[\d,]*\.\d{2}|\.\d{2})(?=\s|$)/g)].map((match) => ({
    raw: match[1],
    index: (match.index ?? 0) + match[0].lastIndexOf(match[1]),
    value: parseStatementAmount(match[1]),
  }));

  if (!amountMatches.length) {
    return {
      debitAmount: null,
      creditAmount: null,
      balanceAmount: null,
    };
  }

  const balanceMatch = amountMatches[amountMatches.length - 1];
  const transactionMatches = amountMatches.slice(0, -1);
  let debitAmount = null;
  let creditAmount = null;

  transactionMatches.forEach((match) => {
    if (match.index >= columnIndexes.creditsStart) {
      creditAmount = match.value;
      return;
    }

    if (match.index >= columnIndexes.debitsStart) {
      debitAmount = match.value;
    }
  });

  if (transactionMatches.length === 1 && debitAmount == null && creditAmount == null) {
    if (transactionMatches[0].index >= columnIndexes.creditsStart) {
      creditAmount = transactionMatches[0].value;
    } else {
      debitAmount = transactionMatches[0].value;
    }
  }

  return {
    debitAmount,
    creditAmount,
    balanceAmount: balanceMatch.value,
  };
}

function inferDebitFromBalance(previousBalance, balanceAmount, amount, description) {
  if (typeof previousBalance === "number" && typeof balanceAmount === "number" && typeof amount === "number") {
    const movement = +(balanceAmount - previousBalance).toFixed(2);
    if (Math.abs(Math.abs(movement) - amount) <= 0.05) {
      return movement < 0;
    }
  }

  return /(ATM|POS|PURCHASE|WITHDRAWAL|PAYMENT|FEE|TRANSFER TO|DEBIT)/i.test(description);
}

function parsePdfStatementTransactions(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const items = [];
  const metadata = {
    balanceForward: null,
    endingBalance: null,
  };
  let currentTransaction = null;
  let columnIndexes = null;

  const finalizeCurrentTransaction = () => {
    if (!currentTransaction) {
      currentTransaction = null;
      return;
    }

    const rawDescription = normalizeWhitespace(currentTransaction.descriptionLines.join(" "));
    if (!rawDescription) {
      currentTransaction = null;
      return;
    }

    if (/Balance Forward/i.test(rawDescription)) {
      if (currentTransaction.balanceAmount != null && !metadata.balanceForward) {
        metadata.balanceForward = {
          amount: currentTransaction.balanceAmount,
          currencyCode: "AWG",
          transactionDate: normalizeStatementDate(currentTransaction.transactionDate),
        };
      }
      currentTransaction = null;
      return;
    }

    if (/^Ending Balance/i.test(rawDescription)) {
      if (currentTransaction.balanceAmount != null) {
        metadata.endingBalance = {
          amount: currentTransaction.balanceAmount,
          currencyCode: "AWG",
          transactionDate: normalizeStatementDate(currentTransaction.transactionDate),
        };
      }
      currentTransaction = null;
      return;
    }

    const amount = currentTransaction.debitAmount ?? currentTransaction.creditAmount ?? null;
    items.push({
      transactionDate: normalizeStatementDate(currentTransaction.transactionDate),
      valueDate: normalizeStatementDate(currentTransaction.valueDate),
      description: rawDescription,
      statementRowText: currentTransaction.statementRowText || "",
      amountCurrency: {
        amount,
        currencyCode: "AWG",
      },
      balanceCurrency: currentTransaction.balanceAmount == null
        ? null
        : {
            amount: currentTransaction.balanceAmount,
            currencyCode: "AWG",
          },
      isDebit: currentTransaction.debitAmount != null,
      referenceNumber: currentTransaction.referenceNumber || "",
      transactionCode: currentTransaction.transactionCode || null,
    });
    currentTransaction = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, " ");

    if (line.includes("Date") && line.includes("Value Date") && line.includes("Description") && line.includes("Debits") && line.includes("Credits") && line.includes("Balance")) {
      finalizeCurrentTransaction();
      columnIndexes = detectStatementColumns(line);
      continue;
    }

    const trimmedLine = line.trim();
    if (shouldIgnoreStatementLine(trimmedLine)) {
      continue;
    }

    if (!columnIndexes) {
      continue;
    }

    const rowMatch = line.match(/^\s*(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2}|99\/99\/99)?\s+/);
    if (rowMatch) {
      finalizeCurrentTransaction();

      const transactionDate = line.slice(0, columnIndexes.valueDateStart).trim();
      const valueDate = line.slice(columnIndexes.valueDateStart, columnIndexes.descriptionStart).trim();
      const description = line.slice(columnIndexes.descriptionStart, columnIndexes.debitsStart).trim();
      const { debitAmount, creditAmount, balanceAmount } = extractStatementAmountsFromLine(line, columnIndexes);

      currentTransaction = {
        transactionDate,
        valueDate,
        debitAmount,
        creditAmount,
        balanceAmount,
        statementRowText: line.trim(),
        referenceNumber: "",
        transactionCode: null,
        descriptionLines: description ? [description] : [],
      };
      continue;
    }

    if (currentTransaction) {
      if (trimmedLine) {
        currentTransaction.descriptionLines.push(trimmedLine);
      }
    }
  }

  finalizeCurrentTransaction();

  return {
    items,
    metadata,
  };
}

function reconcilePdfStatementItems(items, openingBalance = null) {
  let previousBalance = typeof openingBalance === "number" ? openingBalance : null;

  return items.map((item) => {
    const amount = item?.amountCurrency?.amount;
    const currentBalance = item?.balanceCurrency?.amount;

    if (typeof amount !== "number" || typeof currentBalance !== "number" || previousBalance == null) {
      if (typeof currentBalance === "number") {
        previousBalance = currentBalance;
      }

      return item;
    }

    const delta = +(currentBalance - previousBalance).toFixed(2);
    const debitDelta = +(-amount).toFixed(2);
    const creditDelta = +amount.toFixed(2);
    const debitDistance = Math.abs(delta - debitDelta);
    const creditDistance = Math.abs(delta - creditDelta);

    const reconciledIsDebit = debitDistance < creditDistance;
    previousBalance = currentBalance;

    return {
      ...item,
      isDebit: reconciledIsDebit,
    };
  });
}

export async function extractPdfStatementPayload(buffer, options = {}) {
  const result = await pdfParse(buffer);
  const { removeAuthNoise = true } = options;
  const { items, metadata } = parsePdfStatementTransactions(result.text);
  const reconciledItems = reconcilePdfStatementItems(items, metadata.balanceForward?.amount ?? null);

  return buildFilteredSearchPayload(
    {
      items: reconciledItems,
      totalCount: reconciledItems.length,
      totalResults: reconciledItems.length,
      hasMoreResults: false,
      access: true,
      source: "pdf-statement",
      preview: result.text.slice(0, 1500),
      balanceForward: metadata.balanceForward,
      endingBalance: metadata.endingBalance,
    },
    { removeAuthNoise }
  );
}