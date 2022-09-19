require("@openzeppelin/test-helpers/configure")({
    provider: web3.currentProvider,
    singletons: {
      abstraction: "truffle",
    },
  });
  
  const { constants, expectRevert, expectEvent } = require('@openzeppelin/test-helpers');
  const RentableNFT = artifacts.require("RentableNft");
  
  contract("RentableNft", function (accounts) {
    it("should support the ERC721 and ERC4907 standards", async () => {
      const rentableNFTInstance = await RentableNFT.deployed();
      const ERC721InterfaceId = "0x80ac58cd";
      const ERC4907InterfaceId = "0xad092b5c";
      var isERC721 = await rentableNFTInstance.supportsInterface(ERC721InterfaceId);
      var isER4907 = await rentableNFTInstance.supportsInterface(ERC4907InterfaceId); 
      assert.equal(isERC721, true, "RentableNFT is not an ERC721");
      assert.equal(isER4907, true, "RentableNFT is not an ERC4907");
    });
    it("should not set UserInfo if not the owner", async () => {
      const rentableNFTInstance = await RentableNFT.deployed();
      const expirationDatePast = 1660252958; // Aug 8 2022
      await rentableNFTInstance.mint("fakeURI");
      // Failed require in function
      await expectRevert(rentableNFTInstance.setUser(1, accounts[1], expirationDatePast, {from: accounts[1]}), "ERC721: transfer caller is not owner nor approved");
      // Assert no UserInfo for NFT
      var user = await rentableNFTInstance.userOf.call(1);
      var date = await rentableNFTInstance.userExpires.call(1);
      assert.equal(user, constants.ZERO_ADDRESS, "NFT user is not zero address");
      assert.equal(date, 0, "NFT expiration date is not 0");
    });
    it("should return the correct UserInfo", async () => {
      const rentableNFTInstance = await RentableNFT.deployed();
      const expirationDatePast = 1660252958; // Aug 8 2022
      const expirationDateFuture = 4121727755; // Aug 11 2100
      await rentableNFTInstance.mint("fakeURI");
      await rentableNFTInstance.mint("fakeURI");
      // Set and get UserInfo
      var expiredTx = await rentableNFTInstance.setUser(2, accounts[1], expirationDatePast)
      var unexpiredTx = await rentableNFTInstance.setUser(3, accounts[2], expirationDateFuture)
      var expiredNFTUser = await rentableNFTInstance.userOf.call(2);
      var expiredNFTDate = await rentableNFTInstance.userExpires.call(2);
      var unexpireNFTUser = await rentableNFTInstance.userOf.call(3);
      var unexpiredNFTDate = await rentableNFTInstance.userExpires.call(3);
      // Assert UserInfo and event transmission
      assert.equal(expiredNFTUser, constants.ZERO_ADDRESS, "Expired NFT has wrong user");
      assert.equal(expiredNFTDate, expirationDatePast, "Expired NFT has wrong expiration date");
      expectEvent(expiredTx, "UpdateUser", { tokenId: "2", user: accounts[1], expires: expirationDatePast.toString()});
      assert.equal(unexpireNFTUser, accounts[2], "Expired NFT has wrong user");
      assert.equal(unexpiredNFTDate, expirationDateFuture, "Expired NFT has wrong expiration date");
      expectEvent(unexpiredTx, "UpdateUser", { tokenId: "3", user: accounts[2], expires: expirationDateFuture.toString()});
      // Burn NFT
      unexpiredTx = await rentableNFTInstance.burn(3);
      // Assert UserInfo was deleted
      unexpireNFTUser = await rentableNFTInstance.userOf.call(3);
      unexpiredNFTDate = await rentableNFTInstance.userExpires.call(3);
      assert.equal(unexpireNFTUser, constants.ZERO_ADDRESS, "NFT user is not zero address");
      assert.equal(unexpiredNFTDate, 0, "NFT expiration date is not 0");
      expectEvent(unexpiredTx, "UpdateUser", { tokenId: "3", user: constants.ZERO_ADDRESS, expires: "0"});
    });
  });