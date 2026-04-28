/* ---------------------------------------------------------------------------
   Leverage card — interactivity:
   · top tabs (Leverage position / Exit position) — visual swap only
   · YES / NO side selector — visual swap only
   · Amount field with 25 / 50 / 75 / MAX preset buttons
   · 5-stop leverage slider that drives the multiplier readout (0.00× → 5×)
   · The action button enables once an amount > 0 is entered
   --------------------------------------------------------------------------- */

const WALLET_BALANCE = 1200;

/* ---------- Market constants ----------
   Prices come from the static design (32¢ YES / 68¢ NO). YES + NO = 100¢
   in a binary prediction market — the implied probability split. Each
   share pays $1 if its outcome wins, $0 otherwise. */
const YES_PRICE = 0.32;
const NO_PRICE = 0.68;

/* Tunables for the summary calculations. These approximate Polymarket-
   style mechanics + a typical perp-style maintenance margin. Replace
   with the real Varla numbers once the docs are available.

   - PRICE_IMPACT_PER_DOLLAR: linear slippage model. 1% impact per $1k
     of position size, capped at 5% so absurdly large entries don't
     produce nonsense numbers.
   - MAINTENANCE_MARGIN: minimum equity-to-position ratio before the
     position is liquidated. 5% is a common DeFi default. */
const PRICE_IMPACT_PER_DOLLAR = 0.001 / 100; // 0.001% per $1
const MAX_PRICE_IMPACT = 0.05; // 5%
const MAINTENANCE_MARGIN = 0.05;

/* ---------- Top tabs ---------- */
const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => {
      const active = t === tab;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    const target = tab.dataset.tab;
    panels.forEach((p) => {
      p.hidden = p.dataset.panel !== target;
    });
  });
});

/* ---------- YES / NO side selector ---------- */
const sideButtons = document.querySelectorAll(".side-btn");
sideButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    sideButtons.forEach((b) => {
      const active = b === btn;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
    // Side change → reprice the summary (different YES vs NO base price).
    updateSummary();
  });
});

/* ---------- Amount input + percent presets ---------- */
const amountInput = document.querySelector(".amount-card__input");
const percentButtons = document.querySelectorAll(".percent-btn");
const actionBtn = document.getElementById("action-btn");

function setAmount(value) {
  // Round to 2 decimals; allow empty to clear.
  amountInput.value = value === "" ? "" : Number(value).toFixed(2);
  syncActionState();
}

percentButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    percentButtons.forEach((b) => b.classList.toggle("is-active", b === btn));
    const pct = parseInt(btn.dataset.percent, 10) / 100;
    setAmount(WALLET_BALANCE * pct);
  });
});

amountInput?.addEventListener("input", () => {
  // Typing manually clears any active percent preset — value no longer
  // tied to a fixed fraction of wallet.
  percentButtons.forEach((b) => b.classList.remove("is-active"));
  syncActionState();
});

/* ---------- Leverage slider ----------
   Range 0 → 5 in 0.5 steps (11 stops). Display defaults to "0.00 ×" in
   text-secondary; flips to text-primary once the user moves past zero. */
const slider = document.querySelector(".leverage-slider");
const sliderInput = slider?.querySelector(".leverage-slider__input");
const sliderFill = slider?.querySelector(".leverage-slider__fill");
const leverageNumEl = document.querySelector(".leverage-value__num");
const leverageValueEl = document.querySelector(".leverage-value");

function syncSlider() {
  if (!slider || !sliderInput) return;
  const value = parseFloat(sliderInput.value);
  const min = parseFloat(sliderInput.min) || 0;
  const max = parseFloat(sliderInput.max) || 5;
  const pct = (value - min) / (max - min); // 0..1

  // Drive fill via CSS variable; the calc() in CSS handles the thumb
  // offset so the fill ends exactly at the thumb's center.
  slider.style.setProperty("--pct", pct);
  if (leverageNumEl) leverageNumEl.textContent = value.toFixed(2);
  leverageValueEl?.classList.toggle("is-active", value > 0);

  slider.dataset.value = value;
  updateSummary();
}

/* Magnetic snap: when the user drags within ±SNAP_RADIUS of a whole
   number (0, 1, 2, 3, 4, 5), pull the value to that whole number. Outside
   the snap radius the value stays continuous, so the user retains free
   movement between stops. */
const SNAP_RADIUS = 0.15;

sliderInput?.addEventListener("input", () => {
  const raw = parseFloat(sliderInput.value);
  const rounded = Math.round(raw);
  if (Math.abs(raw - rounded) < SNAP_RADIUS) {
    sliderInput.value = rounded;
  }
  syncSlider();
});

syncSlider();

/* ---------- Action button enable/disable + wallet-cap validation ----------
   Button starts disabled (matches the Figma muted state). It activates
   when the user enters a positive amount that doesn't exceed the wallet
   balance. Going over the wallet flips the amount card into the error
   state (red border + error message) — same pattern as settings-modal. */
const amountCard = document.querySelector(".amount-card");

function syncActionState() {
  if (!actionBtn) return;
  const amount = parseFloat(amountInput?.value);
  const hasAmount = !Number.isNaN(amount) && amount > 0;
  const exceedsWallet = hasAmount && amount > WALLET_BALANCE;

  amountCard?.classList.toggle("has-error", exceedsWallet);
  actionBtn.disabled = !hasAmount || exceedsWallet;

  updateSummary();
}

/* ---------- Summary calculations ----------
   Approximations for the four summary rows. These follow standard
   prediction-market mechanics with a perp-style maintenance margin —
   reasonable defaults until the actual Varla docs are available.

   Position size  = amount × leverage
   Price impact   = positionSize × PRICE_IMPACT_PER_DOLLAR  (capped)
   Avg fill price = currentPrice × (1 + impact / 2)
   Shares         = positionSize / avgPrice           (each pays $1 on win)
   Liquidation    = debt / (shares × (1 − MAINT_MARGIN))   (leverage > 1)
   Reward         = shares × (1 − avgPrice)           (profit if win) */
function getCurrentSide() {
  const yesActive = document.querySelector(".side-btn--yes")?.classList.contains("is-active");
  return yesActive ? "yes" : "no";
}

function calcSummary() {
  const amount = parseFloat(amountInput?.value) || 0;
  const leverage = parseFloat(sliderInput?.value) || 0;
  const side = getCurrentSide();
  const currentPrice = side === "yes" ? YES_PRICE : NO_PRICE;

  // No-position cases: empty amount, zero leverage, or over-wallet error.
  if (amount <= 0 || leverage <= 0 || amount > WALLET_BALANCE) {
    return { impact: 0, avgPrice: 0, liqPrice: 0, reward: 0 };
  }

  const positionSize = amount * leverage;
  const impact = Math.min(MAX_PRICE_IMPACT, positionSize * PRICE_IMPACT_PER_DOLLAR);
  const avgPrice = currentPrice * (1 + impact / 2);
  const shares = positionSize / avgPrice;

  // No leverage (1×) means no borrowed capital → no liquidation event;
  // the user can only lose their own collateral.
  let liqPrice = 0;
  if (leverage > 1) {
    const debt = amount * (leverage - 1);
    liqPrice = debt / (shares * (1 - MAINTENANCE_MARGIN));
  }

  const reward = shares * (1 - avgPrice);

  return { impact, avgPrice, liqPrice, reward };
}

function fmtPrice(n) {
  if (n <= 0) return "$0";
  // Sub-dollar share prices benefit from extra precision.
  return "$" + n.toFixed(n < 0.1 ? 4 : 2);
}

function fmtCurrency(n) {
  if (n <= 0) return "$0.00";
  return "$" + n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function updateSummary() {
  const { impact, avgPrice, liqPrice, reward } = calcSummary();
  const set = (key, value) => {
    const el = document.querySelector(`[data-summary="${key}"]`);
    if (el) el.textContent = value;
  };
  set("impact", (impact * 100).toFixed(2) + "%");
  set("avg", fmtPrice(avgPrice));
  set("liq", fmtPrice(liqPrice));
  set("reward", fmtCurrency(reward));
}

syncActionState();

/* ---------------------------------------------------------------------------
   Exit panel — close (or partially close) an existing position.

   Mock position state — these would come from real account data once wired up.
   The summary scales linearly with the close fraction, the HF indicator
   slides between currentHf and projectedHf, and the close button enables
   only once a positive amount within the position value is entered. */
const EXIT_POSITION = {
  positionValue: 4200,    // total notional position (collateral × leverage)
  collateral: 2400,       // user's released collateral at 100% close
  leverage: 2.0,
  side: "yes",            // side of the open position (drives the YES/NO tag)
  exitPrice: 0.3245,      // simulated avg fill price after small slippage
  totalPnl: 336.40,       // positive = profit, negative = loss (at 100% close)
  liquidationPrice: 0.225,
  networkFee: 0.45,       // flat
  currentHf: 1.45,        // before close
  projectedHfFullClose: 1.52, // HF if everything is closed
  hfBarMin: 0,
  hfBarMax: 2,
};

const exitInput = document.getElementById("exit-amount");
const exitCard = exitInput?.closest(".amount-card");
const exitPercentBtns = document.querySelectorAll("[data-exit-percent]");
const closeBtn = document.getElementById("close-btn");
const hfIndicator = document.querySelector('[data-hf="indicator"]');
const hfBefore = document.querySelector('[data-hf="before"]');
const hfAfter = document.querySelector('[data-hf="after"]');

function setExitAmount(value) {
  if (!exitInput) return;
  exitInput.value = value === "" ? "" : Number(value).toFixed(2);
  syncExit();
}

function calcExit() {
  const amount = parseFloat(exitInput?.value) || 0;
  const pct = Math.min(1, amount / EXIT_POSITION.positionValue);
  const value = EXIT_POSITION.collateral * pct;
  const pnl = EXIT_POSITION.totalPnl * pct;
  const fee = pct > 0 ? EXIT_POSITION.networkFee : 0;
  const reward = pct > 0 ? value + pnl - fee : 0;
  // Closing 100% leaves no position → no liquidation. Below that, the
  // existing position keeps its leverage, so the liq price is unchanged.
  const liqPrice = pct >= 1 ? 0 : pct > 0 ? EXIT_POSITION.liquidationPrice : 0;
  // HF improves linearly toward the fully-closed HF.
  const newHf =
    EXIT_POSITION.currentHf +
    (EXIT_POSITION.projectedHfFullClose - EXIT_POSITION.currentHf) * pct;
  return { amount, pct, value, pnl, fee, reward, liqPrice, newHf };
}

function fmtSigned(n) {
  // Match the Figma copy: "+$168.20" / "-$50.00".
  const sign = n >= 0 ? "+" : "-";
  return sign + fmtCurrency(Math.abs(n));
}

function syncExit() {
  if (!exitInput || !exitCard) return;
  const { amount, value, pnl, fee, reward, liqPrice, newHf } = calcExit();
  const exceeds = amount > EXIT_POSITION.positionValue;
  exitCard.classList.toggle("has-error", exceeds);

  // Validity: positive amount within position size.
  const valid = amount > 0 && !exceeds;
  if (closeBtn) closeBtn.disabled = !valid;

  const set = (key, val) => {
    const el = document.querySelector(`[data-exit-summary="${key}"]`);
    if (el) el.textContent = val;
  };
  set("value", fmtCurrency(value));
  set("leverage", EXIT_POSITION.leverage.toFixed(1) + "×");
  set("liq", "$" + liqPrice.toFixed(2));
  set("fee", fee > 0 ? "~" + fmtCurrency(fee) : "~$0.00");
  set("reward", fmtCurrency(reward));

  // PnL row — sign-prefixed and recolored for losses.
  const pnlEl = document.querySelector('[data-exit-summary="pnl"]');
  if (pnlEl) {
    pnlEl.textContent = fmtSigned(pnl);
    pnlEl.classList.toggle("is-loss", pnl < 0);
  }

  // HF indicator: position along the 0→2 bar (clamped).
  if (hfIndicator) {
    const range = EXIT_POSITION.hfBarMax - EXIT_POSITION.hfBarMin;
    const pct = Math.max(0, Math.min(1, (newHf - EXIT_POSITION.hfBarMin) / range));
    hfIndicator.style.left = pct * 100 + "%";
  }
  if (hfBefore) hfBefore.textContent = EXIT_POSITION.currentHf.toFixed(2);
  if (hfAfter) hfAfter.textContent = newHf.toFixed(2);
}

exitInput?.addEventListener("input", () => {
  // Typing manually clears any active percent preset.
  exitPercentBtns.forEach((b) => b.classList.remove("is-active"));
  syncExit();
});

exitPercentBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    exitPercentBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
    const pct = parseInt(btn.dataset.exitPercent, 10) / 100;
    setExitAmount(EXIT_POSITION.positionValue * pct);
  });
});

syncExit();

/* ---------------------------------------------------------------------------
   Leverage trade flow: loading → success
   - "Leverage" action button enters a loading state (spinner over form,
     button label "Processing...", button disabled) for ~1.5s.
   - When loading completes, snapshots the trade into the success card
     and opens the success popup with its draw/bounce icon animation.
   - Success popup closes via Done, X, backdrop, or Esc.
   --------------------------------------------------------------------------- */
const successOverlay = document.getElementById("success-overlay");
const loadingOverlay = document.getElementById("leverage-loading");
const actionLabel = actionBtn?.querySelector(".action-btn__label");
const ORIGINAL_ACTION_LABEL = actionLabel?.textContent || "Leverage";
const LOADING_DURATION_MS = 1500;

function openPopup(overlay) {
  if (!overlay) return;
  overlay.hidden = false;
  void overlay.offsetWidth; // force reflow so the open transition runs
  overlay.classList.add("is-open");
}

function closePopup(overlay) {
  if (!overlay) return;
  overlay.classList.remove("is-open");
  setTimeout(() => { overlay.hidden = true; }, 200);
}

/* Format helpers used only for the success summary. */
function fmtCents(p) {
  if (p <= 0) return "0¢";
  return (p * 100).toFixed(p < 0.1 ? 2 : 1) + "¢";
}

function fmtShares(n) {
  if (n <= 0) return "0 SHARES";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " SHARES";
}

/* Snapshot the live trade values into the success card. Called on
   confirmation so the user sees the exact numbers they committed. */
function populateSuccess() {
  const amount = parseFloat(amountInput?.value) || 0;
  const leverage = parseFloat(sliderInput?.value) || 0;
  const side = getCurrentSide();
  const { avgPrice, liqPrice, reward } = calcSummary();
  const positionSize = amount * leverage;
  const shares = avgPrice > 0 ? positionSize / avgPrice : 0;

  const set = (key, value) => {
    const el = document.querySelector(`[data-success="${key}"]`);
    if (el) el.textContent = value;
  };

  set("market", "Fed Rate Cut Dec?");
  // Side: keep using the .side-tag pill but swap colour + label.
  const sideEl = document.querySelector('[data-success="side"]');
  if (sideEl) {
    sideEl.textContent = side.toUpperCase();
    sideEl.className = `side-tag side-tag--${side} side-tag--sm`;
  }
  set("amount", "$" + amount.toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }));
  set("leverage", leverage.toFixed(1) + "×");
  set("avgEntry", fmtCents(avgPrice));
  set("shares", fmtShares(shares));
  set("liq", fmtCents(liqPrice));
  set("reward", fmtCurrency(reward));
}

/* Toggle the loading state across the panel. The overlay covers the
   form area and the action button switches to a "Processing..." label
   and goes disabled so the user can't double-click. */
function setLeverageLoading(loading) {
  if (!actionBtn || !loadingOverlay) return;
  loadingOverlay.classList.toggle("is-active", loading);
  loadingOverlay.setAttribute("aria-hidden", loading ? "false" : "true");
  actionBtn.disabled = loading || actionBtn.dataset.naturallyDisabled === "true";
  if (actionLabel) {
    actionLabel.textContent = loading ? "Processing..." : ORIGINAL_ACTION_LABEL;
  }
}

actionBtn?.addEventListener("click", () => {
  if (actionBtn.disabled) return;
  // Stash whether the button was already disabled so we restore correctly.
  actionBtn.dataset.naturallyDisabled = "false";
  setLeverageLoading(true);
  setTimeout(() => {
    setLeverageLoading(false);
    populateSuccess();
    // Sync the trade details into the Exit tab so switching tabs after
    // confirming reveals the just-opened position rather than the demo
    // mock data.
    commitOpenPosition();
    openPopup(successOverlay);
  }, LOADING_DURATION_MS);
});

document.getElementById("success-close")?.addEventListener("click", () => closePopup(successOverlay));
document.getElementById("success-done")?.addEventListener("click", () => closePopup(successOverlay));

successOverlay?.addEventListener("click", (e) => {
  if (e.target === successOverlay) closePopup(successOverlay);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && successOverlay?.classList.contains("is-open")) {
    closePopup(successOverlay);
  }
});

/* ---------------------------------------------------------------------------
   Exit close flow: loading → success
   - "Close Position" button enters a loading state (spinner over form,
     button label "Processing...", button disabled) for ~1.5s.
   - When loading completes, snapshots the close into the exit-success
     card and opens the success popup.
   - Closes via Done, X, backdrop, or Esc.
   --------------------------------------------------------------------------- */
const exitSuccessOverlay = document.getElementById("exit-success-overlay");
const exitLoadingOverlay = document.getElementById("exit-loading");
const closeLabel = closeBtn?.querySelector(".close-btn__label");
const ORIGINAL_CLOSE_LABEL = closeLabel?.textContent || "Close Position";

function setExitLoading(loading) {
  if (!closeBtn || !exitLoadingOverlay) return;
  exitLoadingOverlay.classList.toggle("is-active", loading);
  exitLoadingOverlay.setAttribute("aria-hidden", loading ? "false" : "true");
  closeBtn.disabled = loading;
  if (closeLabel) {
    closeLabel.textContent = loading ? "Processing..." : ORIGINAL_CLOSE_LABEL;
  }
}

/* Snapshot the live exit values into the success card. */
function populateExitSuccess() {
  const amount = parseFloat(exitInput?.value) || 0;
  const { pnl, fee, reward } = calcExit();
  const side = EXIT_POSITION.side;

  const set = (key, value) => {
    const el = document.querySelector(`[data-exit-success="${key}"]`);
    if (el) el.textContent = value;
  };

  set("market", "Fed Rate Cut Dec?");

  // Side: keep the .side-tag pill but swap colour + label per side.
  const sideEl = document.querySelector('[data-exit-success="side"]');
  if (sideEl) {
    sideEl.textContent = side.toUpperCase();
    sideEl.className = `side-tag side-tag--${side} side-tag--sm`;
  }

  set("leverage", EXIT_POSITION.leverage.toFixed(1) + "×");
  set("closedAmount", "$" + amount.toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }));
  set("exitPrice", fmtCents(EXIT_POSITION.exitPrice));
  set("fee", fee > 0 ? "~" + fmtCurrency(fee) : "~$0.00");
  set("netReceived", fmtCurrency(reward));

  // PnL — sign-prefixed and recoloured for losses (green default → red on loss).
  const pnlEl = document.querySelector('[data-exit-success="pnl"]');
  if (pnlEl) {
    pnlEl.textContent = fmtSigned(pnl);
    pnlEl.classList.toggle("success-row__value--profit", pnl >= 0);
    pnlEl.classList.toggle("success-row__value--loss", pnl < 0);
  }
}

closeBtn?.addEventListener("click", () => {
  if (closeBtn.disabled) return;
  setExitLoading(true);
  setTimeout(() => {
    setExitLoading(false);
    populateExitSuccess();
    openPopup(exitSuccessOverlay);
  }, LOADING_DURATION_MS);
});

document.getElementById("exit-success-close")?.addEventListener("click", () => closePopup(exitSuccessOverlay));
document.getElementById("exit-success-done")?.addEventListener("click", () => closePopup(exitSuccessOverlay));

exitSuccessOverlay?.addEventListener("click", (e) => {
  if (e.target === exitSuccessOverlay) closePopup(exitSuccessOverlay);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && exitSuccessOverlay?.classList.contains("is-open")) {
    closePopup(exitSuccessOverlay);
  }
});

/* ---------------------------------------------------------------------------
   Cross-tab connection — Leverage → Exit
   When a leverage trade is committed, copy the trade details onto the
   shared EXIT_POSITION state and re-render the Exit panel so the side
   tag, leverage display, position value, and summary all reflect the
   newly-opened position.
   --------------------------------------------------------------------------- */
function commitOpenPosition() {
  const amount = parseFloat(amountInput?.value) || 0;
  const leverage = parseFloat(sliderInput?.value) || 0;
  const side = getCurrentSide();
  const { avgPrice, liqPrice } = calcSummary();
  const positionSize = amount * leverage;
  const shares = avgPrice > 0 ? positionSize / avgPrice : 0;

  // Simulate a small post-entry price drift in the user's favour so the
  // Exit panel has a non-zero PnL to show. For YES, price drifts up;
  // for NO, the YES price drifts down (NO gains). The exit fill price
  // adds a half-percent slippage in the opposite direction.
  const basePrice = side === "yes" ? YES_PRICE : NO_PRICE;
  const driftedPrice = basePrice + (side === "yes" ? 0.02 : -0.02);
  const exitPrice = driftedPrice * (1 - 0.005);

  // Mutate in place so existing references (closures, etc.) keep working.
  EXIT_POSITION.side = side;
  EXIT_POSITION.leverage = leverage;
  EXIT_POSITION.collateral = amount;
  EXIT_POSITION.positionValue = positionSize;
  EXIT_POSITION.avgEntryPrice = avgPrice;
  EXIT_POSITION.shares = shares;
  EXIT_POSITION.exitPrice = exitPrice;
  EXIT_POSITION.totalPnl = shares * (exitPrice - avgPrice);
  EXIT_POSITION.liquidationPrice = liqPrice;

  renderExitPanel();
}

function renderExitPanel() {
  // Compact market card — side tag colour + label follow the position side.
  const exitSideTag = document.querySelector(
    '[data-panel="exit"] .market--compact .side-tag'
  );
  if (exitSideTag) {
    exitSideTag.textContent = EXIT_POSITION.side.toUpperCase();
    exitSideTag.className = `side-tag side-tag--${EXIT_POSITION.side}`;
  }

  // Amount card header — "VALUE:$X,XXX • LEV:Yx" reflects current position.
  const valueHeader = document.querySelector(
    '[data-panel="exit"] .amount-card__wallet'
  );
  if (valueHeader) {
    const lev = EXIT_POSITION.leverage;
    const levStr = lev % 1 === 0 ? lev.toFixed(0) : lev.toFixed(1);
    const valStr = EXIT_POSITION.positionValue.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
    valueHeader.textContent = `VALUE:$${valStr} • LEV:${levStr}×`;
  }

  // Reset the exit form so the new position starts at zero close amount.
  if (exitInput) exitInput.value = "";
  exitPercentBtns.forEach((b) => b.classList.remove("is-active"));
  syncExit();
}
