const walletService = require('./wallet.service');

async function getWallet(req, res) {
  const wallet = await walletService.getWallet(req.user._id);
  res.json({ success: true, data: wallet });
}

async function listTransactions(req, res) {
  const { items, pagination } = await walletService.listTransactions(req.user._id, req.validated.query);
  res.json({ success: true, data: items, pagination });
}

async function fund(req, res) {
  const funding = await walletService.startFunding(req.user, req.body.amountKobo);
  res.status(201).json({ success: true, data: funding });
}

async function getFunding(req, res) {
  const funding = await walletService.getFunding(req.user._id, req.params.reference);
  res.json({ success: true, data: funding });
}

module.exports = { getWallet, listTransactions, fund, getFunding };
