const shopify = require('../services/shopify')
const Shopify = require('shopify-api-node')

class TaxController {

  static  shopify = new Shopify({
    shopName: process.env.SHOPIFY_STORE_NAME,
    apiKey: process.env.SHOPIFY_API_KEY,
    password: process.env.SHOPIFY_API_PASSWORD,
  })

  static async calculateTaxes (_req, res) {

    const { lineItems, stateId } = _req.body
    try {
      const result = await TaxController.#calculateExciseTax(lineItems, stateId)
      res.status(200).json( result )
    } catch (error) {
      res.status(400).json({ error: error })
    }
  }

  static async verifyOrder (_req, res) {
    const order = _req.body
    try {
      const stateId = this.#getState(order.billing_address)
      const tags = order.tags.split(', ').push('tax-issue')
      if (stateId) {
        const quantity = (await TaxController.#calculateExciseTax(order.line_items, stateId))?.summary
        const taxProduct = order.line_items.find(item => {return item.product_id === 7075063005264})
        if (quantity === 0 && !taxProduct || (quantity === taxProduct.quantity)) {
          return res.status(200).json()
        } else {
          await TaxController.shopify.order.update(order.id, { tags: tags.join(', ') })
          return res.status(200).json()
        }
      } else {
        return res.status(200).json()
      }

    } catch (error) {
      res.status(400).json({ error: error })
    }
  }

  static #getStateTaxPrice (stateId) {
    const stateTaxData = {
      '32': { /* Massachusetts */ 'wholesale': 75 },
      '23': { /* Illinois */ 'wholesale': 15 },
      '51': { /* Pennsylvania */ 'wholesale': 40 },
      '26': { /* Kansas */ 'volumebase': 0.05 },
      '14': { /* Connecticut */ 'open': 10, 'close': 0.40 },
      '34': { /* Minnesota */ 'wholesale': 95 },
      '41': { /* New Jersey */ 'open': 10, 'close': 0.10, 'retailprice': 1 },
      '19': { /* Georgia */ 'open': 7, 'close': 0.05, 'retailprice': 1 },
      '62': { /* Washington */ 'open': 0.09, 'close': 0.27, 'onlyvolume': 1 },
      '12': { /* California */ 'open': 12.5, 'close': 12.5, 'retailprice': 1 },
    }

    return stateTaxData[stateId] || {}
  }

  static async #calculateExciseTax (items, stateId) {

    let amount = 0
    const taxValueArr = this.#getStateTaxPrice(stateId)

    if (Object.keys(taxValueArr).length === 0) {
      return {
        summary: amount,
        items: [],
      }
    }
    const itemIds = items.map(item => item.product_id)

    const productPromises = itemIds.map(itemId => shopify.getProductDataById(itemId))
    const productResponses = await Promise.all(productPromises)
    let index = 0
    let exciseItems = []
    for (const item of items) {
      let qty = 1
      let exciseTaxPercent = 0
      let exciseTaxValue = 0
      let exciseVolumeBase = 0
      let exciseRetailBase = 0
      let exciseOnlyVolume = 0

      const product = productResponses[index].product
      index++
      const endType = this.#findMetafieldValueByKey(product, 'ends-type')
      const juiceType = this.#findMetafieldValueByKey(product, 'juice-type')
      const juiceVolume = parseFloat(this.#findMetafieldValueByKey(product, 'juice-volume-ml'))
      const juiceCartridgeType = this.#findMetafieldValueByKey(product, 'juice-cartridge-type')
      if (!endType&&!juiceType&&!juiceVolume&&!juiceCartridgeType){
        continue
      }
      const variant = this.#findVariantById(product, item.variant_id)
      const cost = parseFloat(variant?.inventoryItem?.unitCost?.amount || 0)
      // Do not charge excise tax on 0 nicotine products in CA
      if (stateId === 12 && endType === 'NoNicotine') {
        continue
      }

      const itemParent = item
      qty = itemParent.quantity
      const itemPrice = itemParent.price
      if (['23', '32', '34', '51'].includes(stateId)) {
        if (taxValueArr.wholesale && cost) {
          amount += parseInt(((cost * taxValueArr.wholesale / 100) * qty))
          itemParent.exciseTax = parseInt((cost * taxValueArr.wholesale / 100) * qty)
        }
      }
      else {
        if (juiceType === 'Open') {
          exciseTaxPercent = taxValueArr.open
        } else if (juiceType === 'Closed') {
          if (['39', '12'].includes(stateId)) {
            exciseTaxValue = 0
            exciseTaxPercent = taxValueArr.open
          } else {
            exciseTaxValue = taxValueArr.close

          }
        }
        if (stateId === 19 && juiceType === 'Closed' && juiceCartridgeType === 'single-use') {
          exciseTaxValue = 0
          exciseTaxPercent = taxValueArr.open
        }
        exciseVolumeBase = taxValueArr.volumebase || 0
        exciseRetailBase = taxValueArr.retailprice || 0
        exciseOnlyVolume = taxValueArr.onlyvolume || 0
        // For items who have not set juice_type or juice_volume
        if (exciseTaxPercent === 0 && stateId === '12') {
          exciseTaxPercent = taxValueArr.open
        }
        // Volume Base
        if (exciseVolumeBase && juiceVolume) {

          amount += parseInt((juiceVolume * exciseVolumeBase * qty))
          itemParent.exciseTax = parseInt((juiceVolume * exciseVolumeBase * qty))

        } else if (exciseRetailBase && itemPrice && exciseTaxPercent) {

          amount += parseInt(((itemPrice * exciseTaxPercent ) * qty))
          itemParent.exciseTax = parseInt((itemPrice * exciseTaxPercent ) * qty)


        } else if (exciseOnlyVolume && juiceVolume) {
          let exciseAmt = 0
          if (juiceType === 'Open') {

            exciseAmt = taxValueArr.open
          } else if (juiceType === 'Closed') {
            exciseAmt = taxValueArr.close
          }
          amount += parseInt((juiceVolume * exciseAmt * qty))
          itemParent.exciseTax = parseInt((juiceVolume * exciseAmt * qty))

        } else {

          // Open
          if (cost && exciseTaxPercent) {
            amount += parseInt(((cost * exciseTaxPercent ) * qty))
            itemParent.exciseTax = parseInt((cost * exciseTaxPercent ) * qty)
          }
          // Closed
          if (exciseTaxValue && juiceVolume) {
            amount += parseInt(((juiceVolume * exciseTaxValue) * qty))
            itemParent.exciseTax = parseInt((juiceVolume * exciseTaxValue * qty))
          }

        }

      }
      exciseItems.push({
        title: itemParent.handle,
        tax: itemParent.exciseTax / 100,
      })
    }
    return {
      summary: amount,
      items: exciseItems,
    }
  }

  static #findMetafieldValueByKey (product, searchKey) {
    const edges = product?.metafields?.edges

    for (const edge of edges) {
      const { key, value } = edge.node
      if (key === searchKey) {
        return value
      }
    }

    return false
  }

  static #findVariantById (product, variantId) {
    const nodes = product.variants.nodes

    for (const node of nodes) {
      if (node.id.replace('gid://shopify/ProductVariant/', '') == variantId) {
        return node
      }
    }

    return null
  }

  static #getState (billingAddress) {
    if (!billingAddress) {
      return false
    }
    if (billingAddress.country_code !== 'US') {
      return false
    }
    const province = billingAddress?.province
    return null
  }
}

module.exports = TaxController
