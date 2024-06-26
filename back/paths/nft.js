const express = require('express');
const router = express.Router();
const xrpl = require('xrpl');
const xrplClient = require('../utils/xrpl');
const auth = require('../utils/auth');
const db = require('../utils/db');
const sketch = require('../utils/sketch');
const uploadToIpfs = require('../utils/ipfs');
const getXumm = require('../utils/xumm');
const { createQueryAsync, urlToHex, hexToUrl, ipfsToUrl } = require('../utils/helpers');

// Query asynchrone
const queryAsync = createQueryAsync(db);

async function createNFT(url) {

  // Connect to the XRPL
  await xrplClient.connect();

  // Get wallet
  const wallet = xrpl.Wallet.fromSeed(process.env.XRP_WALLET_SEED);

  // Create a transaction to mint an NFT
  const nftMintTx = {
    "TransactionType": "NFTokenMint",
    "Account": wallet.address,
    "Flags": 8,
    "NFTokenTaxon": 0,  // Zero means no special taxonomy
    "Fee": "10",
    "URI": urlToHex(url)
  };

  console.log("Creation of the NFT is currently in progress...");
  const tx = await xrplClient.submitAndWait(nftMintTx, { wallet });

  const transactionResult = tx.result.meta.TransactionResult;
  const nftAddress = tx.result.meta.nftoken_id;

  // Disconnect from the client
  await xrplClient.disconnect();

  if (transactionResult === "tesSUCCESS") {
    return (nftAddress);
  } else {
    return ("Error");
  }
}

async function infoNFT(address) {

  // Connect to the XRPL
  await xrplClient.connect();

  const nftData = await xrplClient.request({
    "command": "nft_info",
    "nft_id": address
  });

  // Disconnect from the client
  await xrplClient.disconnect();

  const isBurned = nftData.result.is_burned;
  const owner = nftData.result.owner;
  const uri = hexToUrl(nftData.result.uri);
  const url = ipfsToUrl(hexToUrl(nftData.result.uri));

  return { isBurned, owner, uri, url };
}

async function sellOffer(nftAddress) {

  await xrplClient.connect();
  const wallet = xrpl.Wallet.fromSeed(process.env.XRP_WALLET_SEED);

  const sellOfferTx = {
    "TransactionType": "NFTokenCreateOffer",
    "Account": wallet.address,
    "NFTokenID": nftAddress,
    "Amount": "0",
    "Flags": xrpl.NFTokenCreateOfferFlags.tfSellNFToken
  };

  const tx = await xrplClient.submitAndWait(sellOfferTx, { wallet });
  await xrplClient.disconnect();

  // Check if the transaction was successful
  if (tx.result.meta.TransactionResult === "tesSUCCESS") {
    return (tx.result.meta.offer_id);
  } else {
    return ('Error');
  }
}

async function acceptOffer(offerId) {

  const xumm = getXumm();

  // Generate accept offer
  const payload = await xumm.payload?.create({
    txjson: {
      TransactionType: "NFTokenAcceptOffer",
      NFTokenSellOffer: offerId,
    },
  });

  // Return payload
  return payload;
}

// Get path
router.get('/get', auth, async (req, res) => {

  try {
    let nftAddress = 0;

    // Prepared SQL query to prevent SQL injection
    const query1 = 'SELECT * FROM nft WHERE userId = ?';
    const result1 = await queryAsync(query1, [req.decoded.userId]);

    if (result1.length === 0) {
      const filePath = await sketch();
      const hashIPFS = await uploadToIpfs("NFT Image", "./" + filePath);
      nftAddress = await createNFT("ipfs://" + hashIPFS);
      const query2 = `
        INSERT INTO nft (userId, address)
        VALUES (?, ?)
      `;
      const result2 = await queryAsync(query2, [req.decoded.userId, nftAddress]);
    } else {
      nftAddress = result1[0].address;
    }

    const { isBurned, owner, uri, url } = await infoNFT(nftAddress);

    res.status(200).json(
      {
        address: nftAddress,
        isBurned: isBurned,
        owner: owner,
        uri: uri,
        url: url
      });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Withdrawn path
router.get('/withdrawn', auth, async (req, res) => {

  try {
    // Prepared SQL query to prevent SQL injection
    const query1 = 'SELECT * FROM nft WHERE userId = ?';
    const result1 = await queryAsync(query1, [req.decoded.userId]);
    const nftAddress = result1[0].address;

    const offerId = await sellOffer(nftAddress);
    const xummRes = await acceptOffer(offerId);

    res.status(200).json({ xummUrl: xummRes.next.always, xummQr: xummRes.refs.qr_png });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
