import { createContext, useContext, useCallback, useEffect, useState } from "react";
import { useEth } from "../EthContext";
import { useInfura } from "../InfuraContext";
import { getIpfsGatewayUri } from "../../utils";

const MarketplaceContext = createContext();

function MarketplaceProvider({ children }) {
  const [listings, setListings] = useState(null);
  const [listingsTransformed, setListingsTransformed] = useState(null);
  const [ownedTokens, setOwnedTokens] = useState(null);
  const { web3, artifacts, contracts, accounts } = useEth().state;
  const {
    Marketplace: marketplaceContract,
    RentableNft: rentableNftContract,
  } = contracts || {};
  const infura = useInfura();

  const updateListings = useCallback(
    async () => {
      if (marketplaceContract) {
        const res = await marketplaceContract.methods.getAllListings().call();

        const listingsExtendedTransformed = {};

        const listingsExtended = await Promise.all(
          res.map(async listing => {
            const {
              nftContract: nftContractAddress,
              pricePerDay: pricePerDayStr,
              startDateUNIX: startDateUnixStr,
              endDateUNIX: endDateUnixStr,
              expires: expiresStr,
              tokenId,
              owner,
              user
            } = listing;
            const nftContract = new web3.eth.Contract(
              artifacts.RentableNft.abi, nftContractAddress
            );
            const tokenUri = await nftContract.methods.tokenURI(tokenId).call();
            let tokenUriRes;
            try {
              tokenUriRes = await (await fetch(getIpfsGatewayUri(tokenUri))).json();
            } catch (err) {
              console.error("Bad uri");
            }
            // const noUser = parseInt(user) !== 0;
            const pricePerDay = parseInt(pricePerDayStr);
            const startDateUnix = parseInt(startDateUnixStr);
            const endDateUnix = parseInt(endDateUnixStr);
            const duration = endDateUnix - startDateUnix;
            const expires = parseInt(expiresStr);
            const isOwner = owner === accounts[0];
            const isUser = user === accounts[0];
            const transformedData = {
              pricePerDay,
              startDateUnix,
              endDateUnix,
              duration,
              expires,
              user
            };
            const listingExtended = {
              ...listing,
              ...transformedData,
              nftContractAddress,
              tokenUri,
              tokenUriRes,
              isOwner,
              isUser
            };
            [
              ...Array(8).keys(),
              "nftContract",
              "startDateUNIX",
              "endDateUNIX",
            ].forEach(i => void delete listingExtended[i]);

            if (listingsExtendedTransformed[nftContractAddress]) {
              listingsExtendedTransformed[nftContractAddress][tokenId] = transformedData;
            } else {
              listingsExtendedTransformed[nftContractAddress] = { [tokenId]: transformedData };
            }

            return listingExtended;
          })
        );

        setListings(listingsExtended);
        setListingsTransformed(listingsExtendedTransformed);
      }
    },
    [
      marketplaceContract,
      web3?.eth.Contract,
      artifacts?.RentableNft.abi,
      accounts
    ]);
  useEffect(() => void updateListings(), [updateListings]);

  const updateOwnedTokens = useCallback(
    async () => {
      if (infura.active) {
        // Option 1 - Use infura nft sdk
        if (accounts && listingsTransformed) {
          const res = await infura.getOwnedRentableNfts(accounts[0]);
          const tokens = await Promise.all(
            res.map(async ele => {
              return {
                nftContractAddress: ele.contract,
                tokenId: ele.tokenId,
                tokenUriRes: ele.metadata,
                listingData: listingsTransformed[ele.contract]?.[ele.tokenId]
              }
            })
          )
          setOwnedTokens(tokens);
        }
      } else {
        // Option - 2 - Use contract events
        // This is useful when using local network (ganache) or network otherwise unsupported
        // docs.infura.io/infura/infura-custom-apis/nft-sdk/supported-networks
        if (rentableNftContract && listingsTransformed) {
          const { address: nftContractAddress } = rentableNftContract.options;
          // This only checks `rentableNftContract`. 
          const mintEvents = await rentableNftContract.getPastEvents("Transfer", {
            filter: {
              from: "0x0000000000000000000000000000000000000000",
              to: accounts[0]
            },
            fromBlock: 0
          });
          const tokens = await Promise.all(
            mintEvents.map(async mintEvent => {
              const { tokenId } = mintEvent.returnValues;
              const tokenUri = await rentableNftContract.methods.tokenURI(tokenId).call();
              let tokenUriRes;
              try {
                tokenUriRes = await (await fetch(getIpfsGatewayUri(tokenUri))).json();
              } catch (err) {
                console.error("Bad uri");
              }
              return {
                nftContractAddress,
                tokenId,
                tokenUri,
                tokenUriRes,
                listingData: listingsTransformed[nftContractAddress]?.[tokenId]
              };
            })
          );
          setOwnedTokens(tokens);
        }
      }
    },
    [
      rentableNftContract,
      listingsTransformed,
      accounts,
      infura.getOwnedRentableNfts
    ]);
  useEffect(() => void updateOwnedTokens(), [updateOwnedTokens]);

  const mint = async (tokenUri) => {
    const tx = await rentableNftContract.methods.mint(tokenUri).send({ from: accounts[0] });
    if (tx.status) await updateOwnedTokens();
  };

  const list = async (nftContractAddress, tokenId, price, duration) => {
    // Time values are in seconds
    const buffer = 30;
    const start = Math.ceil(Date.now() / 1000) + buffer;
    const end = start + duration;
    const listingFee = await marketplaceContract.methods.getListingFee().call();
    const tx = await marketplaceContract.methods.listNFT(
      nftContractAddress,
      tokenId,
      price,
      start,
      end
    ).send({
      from: accounts[0],
      value: listingFee
    });
    if (tx.status) await updateListings();
  };

  const unlist = async (nftContractAddress, tokenId) => {
    const nftContract = new web3.eth.Contract(
      artifacts.RentableNft.abi, nftContractAddress
    );
    const expires = parseInt(await nftContract.methods.userExpires(tokenId).call());
    const { pricePerDay } = listingsTransformed[nftContractAddress][tokenId];
    const refund = Math.ceil((expires - Date.now() / 1000) / 60 / 60 / 24 + 1) * pricePerDay;
    const options = { from: accounts[0], value: Math.max(0, refund) };
    const tx = await marketplaceContract.methods.unlistNFT(nftContractAddress, tokenId).send(options);
    if (tx.status) await updateListings();
  };

  const rent = async (nftContractAddress, tokenId, duration) => {
    const { pricePerDay } = listingsTransformed[nftContractAddress][tokenId];
    const now = Math.ceil(Date.now() / 1000);
    const expires = now + duration;
    const numDays = (expires - now) / 60 / 60 / 24 + 1;
    const fee = Math.ceil(numDays * pricePerDay);
    const options = { from: accounts[0], value: fee };
    const tx = await marketplaceContract.methods.rentNFT(nftContractAddress, tokenId, expires).send(options);
    if (tx.status) await updateListings();
  };

  console.debug({ listings, listingsTransformed, ownedTokens });

  return (
    <MarketplaceContext.Provider value={{
      listings: listings || [],
      ownedTokens: ownedTokens || [],
      mint,
      list,
      unlist,
      rent
    }}>
      {children}
    </MarketplaceContext.Provider>
  );
}

const useMarketplace = () => useContext(MarketplaceContext);

export { MarketplaceProvider, useMarketplace };