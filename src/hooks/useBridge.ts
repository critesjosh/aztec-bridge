import { useState, useCallback, useEffect } from 'react'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { ADDRESS } from '@/config'
import { useAccount as useAztecAccount } from '@nemi-fi/wallet-sdk/react'
import { sdk, pxe } from '@/aztec'
import {
  L1TokenPortalManager,
  L1TokenManager,
  EthAddress,
  AztecAddress,
  createLogger,
  Fr,
  SponsoredFeePaymentMethod,
  readFieldCompressedString,
} from '@aztec/aztec.js'
// import { TokenContract } from '@aztec/noir-contracts.js/Token'
import { TokenBridgeContract } from '@aztec/noir-contracts.js/TokenBridge'
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC'

import { useAztecWallet } from './useAztecWallet'
import { TokenContract } from '../constants/aztec/artifacts/Token'

import {
  BatchCall,
  type IntentAction,
  Contract,
} from '@nemi-fi/wallet-sdk/eip1193'
import { L1ContractAddresses } from '@aztec/ethereum'

class L2SponseredFPC extends Contract.fromAztec(SponsoredFPCContract) { }
class L2Token extends Contract.fromAztec(TokenContract) { }
class L2TokenBridge extends Contract.fromAztec(TokenBridgeContract) { }

const logger = createLogger('aztec:token-bridge:webapp')

export function useBridge() {
  // L1 (MetaMask)
  const { address: l1Address, isConnected: isL1Connected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  // L2 (Obsidian/Aztec)
  const {
    account: aztecAccount,
    address: aztecAddress,
    isConnected: isL2Connected,
  } = useAztecWallet()

  // State
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [l1ContractAddresses, setL1ContractAddresses] =
    useState<L1ContractAddresses | null>(null)

  const [l1Balance, setL1Balance] = useState<string>()
  const [l2Balance, setL2Balance] = useState<string>()
  const [l2TokenContract, setL2TokenContract] = useState<L2Token | null>(null)
  const [l2BridgeContract, setL2BridgeContract] =
    useState<L2TokenBridge | null>(null)
  // const [paymentMethod, setPaymentMethod] =
  //   useState<SponsoredFeePaymentMethod | null>(null)

  // Logger

  // Setup L2 contract instances when aztecAccount is available
  useEffect(() => {
    async function setupContracts() {
      logger.info('Setting up L2 contracts...')
      if (!aztecAccount || !L2Token || !L2TokenBridge) {
        logger.warn('Missing required dependencies for contract setup')
        return
      }

      try {
        const l1ContractAddresses =
          await aztecAccount.aztecNode.getL1ContractAddresses()
        logger.info('Retrieved L1 contract addresses', {
          registry: l1ContractAddresses.registryAddress.toString(),
          inbox: l1ContractAddresses.inboxAddress.toString(),
          outbox: l1ContractAddresses.outboxAddress.toString(),
          rollup: l1ContractAddresses.rollupAddress.toString(),
        })
        setL1ContractAddresses(l1ContractAddresses)

        const token = await L2Token.at(
          AztecAddress.fromString(ADDRESS[1337].L2.TOKEN_CONTRACT),
          aztecAccount
        )
        logger.info('Initialized L2 token contract')
        setL2TokenContract(token)

        const bridge = await L2TokenBridge.at(
          AztecAddress.fromString(ADDRESS[1337].L2.TOKEN_BRIDGE_CONTRACT),
          aztecAccount
        )
        logger.info('Initialized L2 bridge contract')
        setL2BridgeContract(bridge)
      } catch (error) {
        logger.error('Failed to setup contracts', { error })
      }
    }
    if (aztecAccount && L2Token && L2TokenBridge) {
      setupContracts()
    }
  }, [aztecAccount])

  // useEffect(() => {
  //   const loadToken = async () => {
  //     if (aztecAccount && l2TokenContract && l2BridgeContract) {
  //       logger.info('Loading token information...')
  //       try {
  //         const config = await l2BridgeContract?.methods
  //           .get_config_public({})
  //           .simulate()
  //         logger.info('Retrieved bridge config', { config })

  //         const [nameResponse, symbolResponse, decimals] = await Promise.all([
  //           l2TokenContract.methods.public_get_name({}).simulate(),
  //           l2TokenContract.methods.public_get_symbol({}).simulate(),
  //           l2TokenContract.methods.public_get_decimals().simulate(),
  //         ])
  //         const name = readFieldCompressedString(nameResponse as any)
  //         const symbol = readFieldCompressedString(symbolResponse as any)

  //         logger.info('Retrieved token information', {
  //           name,
  //           symbol,
  //           decimals,
  //         })
  //       } catch (error) {
  //         logger.error('Failed to load token information', { error })
  //       }
  //     }
  //   }

  //   loadToken()
  // }, [l2TokenContract, l2BridgeContract, aztecAccount])

  // L1TokenPortalManager instance
  const getL1PortalManager = useCallback(() => {
    logger.info('Getting L1 portal manager...')
    if (
      !publicClient ||
      !walletClient ||
      !l1ContractAddresses?.outboxAddress.toString()
    ) {
      logger.warn('Missing required dependencies for L1 portal manager')
      return null
    }

    const manager = new L1TokenPortalManager(
      EthAddress.fromString(ADDRESS[11155111].L1.PORTAL_CONTRACT),
      EthAddress.fromString(ADDRESS[11155111].L1.TOKEN_CONTRACT),
      EthAddress.fromString(ADDRESS[11155111].L1.FEE_ASSET_HANDLER_CONTRACT),
      EthAddress.fromString(l1ContractAddresses?.outboxAddress.toString()),
      // @ts-ignore
      publicClient,
      walletClient,
      logger
    )
    logger.info('Created L1 portal manager instance')
    return manager
  }, [publicClient, walletClient, l1ContractAddresses])

  // L1TokenManager instance
  const getL1TokenManager = useCallback(() => {
    logger.info('Getting L1 token manager...')
    if (!publicClient || !walletClient) {
      logger.warn('Missing required dependencies for L1 token manager')
      return null
    }
    const manager = new L1TokenManager(
      EthAddress.fromString(ADDRESS[11155111].L1.TOKEN_CONTRACT),
      EthAddress.fromString(ADDRESS[11155111].L1.FEE_ASSET_HANDLER_CONTRACT),
      // @ts-ignore
      publicClient,
      walletClient,
      logger
    )
    logger.info('Created L1 token manager instance')
    return manager
  }, [publicClient, walletClient])

  // Get L1 balance
  const getL1Balance = useCallback(async () => {
    if (!l1Address) {
      logger.warn('No L1 address available for balance check')
      return
    }
    try {
      logger.info('Fetching L1 balance...')
      setLoading(true)
      const manager = getL1TokenManager()
      if (!manager) throw new Error('L1TokenManager not ready')
      const balance = await manager.getL1TokenBalance(l1Address)
      logger.info('Retrieved L1 balance', { balance: balance.toString() })
      setL1Balance(balance.toString())
      setLoading(false)
      return balance
    } catch (e) {
      logger.error('Failed to fetch L1 balance', { error: e })
      setError('Failed to fetch L1 balance')
      setLoading(false)
    }
  }, [getL1TokenManager, l1Address])

  // Get L2 balance
  const getL2Balance = useCallback(async () => {
    if (!aztecAddress || !l2TokenContract) {
      logger.warn('Missing required dependencies for L2 balance check')
      return
    }
    try {
      logger.info('Fetching L2 balance...')
      setLoading(true)
      const balance = await l2TokenContract.methods
        .balance_of_public(AztecAddress.fromString(aztecAddress))
        .simulate()

      logger.info('Retrieved L2 balance', { balance: balance.toString() })
      setL2Balance(balance.toString())
      setLoading(false)
      return balance
    } catch (e) {
      logger.error('Failed to fetch L2 balance', { error: e })
      setError('Failed to fetch L2 balance')
      setLoading(false)
    }
  }, [aztecAddress, l2TokenContract])

  // getL1Balance
  useEffect(() => {
    if (
      !l1Address ||
      !isL1Connected ||
      !l1ContractAddresses ||
      !getL1TokenManager
    ) {
      logger.warn('Missing dependencies for L1 balance effect')
      return
    }
    getL1Balance()
  }, [
    l1Address,
    getL1Balance,
    isL1Connected,
    l1ContractAddresses,
    getL1TokenManager,
  ])

  // getL2Balance
  useEffect(() => {
    if (!aztecAddress || !l2TokenContract || !isL2Connected || !getL2Balance) {
      logger.warn('Missing dependencies for L2 balance effect')
      return
    }
    getL2Balance()
  }, [aztecAddress, l2TokenContract, getL2Balance, isL2Connected])

  const mintL1Tokens = async () => {
    if (!walletClient || !l1ContractAddresses || !l1Address) {
      logger.warn('Missing dependencies for L1 token minting')
      return
    }
    try {
      logger.info('Starting L1 token minting process...')
      setLoading(true)
      setError(null)
      const l1TokenManager = getL1TokenManager()
      if (!l1TokenManager) throw new Error('L1TokenManager not ready')
      const mintAmount = await l1TokenManager.getMintAmount()
      logger.info('Retrieved mint amount', { mintAmount: mintAmount.toString() })

      logger.info('Initiating mint transaction...')
      const minting = await l1TokenManager.mint(l1Address)
      logger.info('Mint transaction sent')

      logger.info('Waiting for transaction confirmation...')
      await new Promise((resolve) => setTimeout(resolve, 5000))

      const newL1Balance = await getL1Balance()
      logger.info('Minting completed', {
        newBalance: newL1Balance?.toString(),
        address: l1Address,
      })

      setLoading(false)
    } catch (e: any) {
      logger.error('Failed to mint L1 tokens', { error: e })
      setError(e.message || 'Failed to mint L1 tokens')
      setLoading(false)
    }
  }

  // Bridge tokens to L2
  const bridgeTokensToL2 = useCallback(
    async (amount: bigint) => {
      if (!l1Address || !aztecAccount) {
        logger.warn('Missing required accounts for bridging')
        setError('L1 or L2 account not ready')
        return
      }
      logger.info('Starting bridge to L2 process...', { amount: amount.toString() })
      setLoading(true)
      setError(null)
      try {
        const manager = getL1PortalManager()
        if (!manager) {
          logger.warn('L1TokenPortalManager not ready')
          setLoading(false)
          return
        }
        if (!aztecAddress) {
          logger.warn('L2 address not ready')
          setLoading(false)
          return
        }

        if (!l2TokenContract) {
          logger.warn('L2 token contract not ready')
          setLoading(false)
          return
        }
        if (!l2BridgeContract) {
          logger.warn('L2 bridge contract not ready')
          setLoading(false)
          return
        }

        logger.info('Initiating bridge tokens to L2...')
        const claim = await manager.bridgeTokensPublic(
          AztecAddress.fromString(aztecAddress),
          amount,
          false // mint
        )
        logger.info('Bridge tokens transaction sent', { claim })

        logger.info('Preparing L2 transactions...')


        logger.info('Waiting 2 minutes before proceeding...')
        await new Promise(resolve => setTimeout(resolve, 120000)) // 2 minute wait

        // const mintPublicTx1 = await l2TokenContract.methods
        //   .mint_to_public(AztecAddress.fromString(aztecAddress), BigInt(0))
        //   .request()
        // const mintPublicTx2 = await l2TokenContract.methods
        //   .mint_to_public(AztecAddress.fromString(aztecAddress), BigInt(0))
        //   .request()

        logger.info('Preparing claim transaction...')
        const claimPublic = await l2BridgeContract.methods
          .claim_public(
            AztecAddress.fromString(aztecAddress),
            amount,
            claim.claimSecret,
            claim.messageLeafIndex
          )
          .request()

        logger.info('Creating batch transaction...')
        const batchedTx = new BatchCall(aztecAccount, [
          // mintPublicTx1,
          // mintPublicTx2,
          claimPublic,
        ])
        logger.info('Sending batch transaction...')
        const batchedTxHash = await batchedTx.send().wait({
          timeout: 200000,
        })
        logger.info('Batch transaction completed', { txHash: batchedTxHash })

        logger.info('Updating balances...')
        await getL1Balance()
        await getL2Balance()

        setLoading(false)
        return claim
      } catch (e: any) {
        logger.error('Failed to bridge tokens to L2', { error: e })
        setError(e.message || 'Failed to bridge tokens to L2')
        setLoading(false)
      }
    },
    [
      l1Address,
      aztecAccount,
      getL1PortalManager,
      aztecAddress,
      l2TokenContract,
      l2BridgeContract,
      getL1Balance,
      getL2Balance,
    ]
  )

  // Withdraw tokens to L1 (full flow)
  const withdrawTokensToL1 = useCallback(
    async (amount: bigint) => {
      if (!aztecAccount || !l2TokenContract || !l2BridgeContract || !l1Address) {
        logger.warn('Missing required dependencies for withdrawal')
        return
      }
      logger.info('Starting withdrawal to L1 process...', { amount: amount.toString() })
      setLoading(true)
      setError(null)
      try {
        logger.info('Generating nonce for withdrawal...')
        const nonce = Fr.random()

        logger.info('Setting up authorization...')
        // @ts-ignore
        const authwit = await aztecAccount.setPublicAuthWit(
          {
            caller: l2BridgeContract.address,
            action: l2TokenContract.methods.burn_public(
              AztecAddress.fromString(aztecAccount.address.toString()),
              amount,
              nonce
            ),
          },
          true
        )
        await authwit.send().wait()
        logger.info('Authorization completed')

        logger.info('Getting L1 portal manager...')
        const manager = getL1PortalManager()
        if (!manager) throw new Error('L1TokenPortalManager not ready')

        logger.info('Getting L2 to L1 message...')
        const l2ToL1Message = await manager.getL2ToL1MessageLeaf(
          amount,
          EthAddress.fromString(l1Address),
          l2BridgeContract.address,
          EthAddress.ZERO
        )
        logger.info('Retrieved L2 to L1 message', { message: l2ToL1Message })

        logger.info('Initiating exit to L1...')
        const l2TxReceipt = await l2BridgeContract.methods
          .exit_to_l1_public(
            EthAddress.fromString(l1Address),
            amount,
            EthAddress.ZERO,
            nonce
          )
          .send()
          .wait()
        logger.info('Exit to L1 transaction completed', { txReceipt: l2TxReceipt })

        logger.info('Getting L2 to L1 message membership witness...')
        const [l2ToL1MessageIndex, siblingPath] =
          await pxe.getL2ToL1MessageMembershipWitness(
            Number(l2TxReceipt.blockNumber!),
            l2ToL1Message
          )
        logger.info('Retrieved membership witness', {
          messageIndex: l2ToL1MessageIndex,
          siblingPath: siblingPath.toString()
        })

        logger.info('Initiating withdrawal on L1...')
        await manager.withdrawFunds(
          amount,
          EthAddress.fromString(l1Address),
          BigInt(l2TxReceipt.blockNumber!),
          l2ToL1MessageIndex,
          siblingPath
        )
        logger.info('Withdrawal completed successfully')
        setLoading(false)
      } catch (e: any) {
        logger.error('Failed to withdraw tokens to L1', { error: e })
        setError(e.message || 'Failed to withdraw tokens to L1')
        setLoading(false)
      }
    },
    [
      aztecAccount,
      l2TokenContract,
      l2BridgeContract,
      l1Address,
      getL1PortalManager,
    ]
  )

  // Get L2 to L1 membership witness (PXE)
  const getL2ToL1MessageMembershipWitness = useCallback(
    async (blockNumber: bigint, l2ToL1Message: any) => {
      logger.info('Getting L2 to L1 message membership witness...', {
        blockNumber: blockNumber.toString(),
        message: l2ToL1Message.toString()
      })
      return await aztecAccount?.aztecNode.getL2ToL1MessageMembershipWitness(
        Number(blockNumber),
        l2ToL1Message
      )
    },
    [aztecAccount]
  )

  return {
    loading,
    error,
    l1Balance,
    l2Balance,
    getL1Balance,
    getL2Balance,
    bridgeTokensToL2,
    withdrawTokensToL1,
    getL2ToL1MessageMembershipWitness,
    mintL1Tokens,
  }
}
