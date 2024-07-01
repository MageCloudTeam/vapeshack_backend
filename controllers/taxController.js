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
      res.status(200).json(result)
    } catch (error) {
      res.status(400).json({ error: error })
    }
  }

  static async verifyOrder (_req, res) {
    console.log(_req.body)
    try {
      const order = _req.body
      const stateId = TaxController.#getStateId(order.billing_address.province)
      let tags = order.tags.split(', ')
      tags.push('tax-issue')
      if (stateId) {
        const quantity = (await TaxController.#calculateExciseTax(order.line_items, stateId.toString()))?.summary
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
      console.log(error)
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
      if (!endType && !juiceType && !juiceVolume && !juiceCartridgeType) {
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
          amount += parseInt(((cost * taxValueArr.wholesale) * qty))
          itemParent.exciseTax = parseInt((cost * taxValueArr.wholesale) * qty)
        }
      } else {
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

          amount += parseInt(((itemPrice * exciseTaxPercent) * qty))
          itemParent.exciseTax = parseInt((itemPrice * exciseTaxPercent) * qty)

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
            amount += parseInt(((cost * exciseTaxPercent) * qty))
            itemParent.exciseTax = parseInt((cost * exciseTaxPercent) * qty)
          }
          // Closed
          if (exciseTaxValue && juiceVolume) {
            amount += parseInt(((juiceVolume * exciseTaxValue) * qty))
            itemParent.exciseTax = parseInt((juiceVolume * exciseTaxValue * qty))
          }

        }

      }
      exciseItems.push({
        title: `${itemParent.title}-${itemParent.variant_title}`,
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

  static #getStateId (stateName) {
    if (!stateName) {
      return false
    }
    const statesData = {
      'states': [
        { 'name': 'Alabama', 'id': 1 },
        { 'name': 'Alaska', 'id': 2 },
        { 'name': 'American Samoa', 'id': 3 },
        { 'name': 'Arizona', 'id': 4 },
        { 'name': 'Arkansas', 'id': 5 },
        { 'name': 'Armed Forces Africa', 'id': 6 },
        { 'name': 'Armed Forces Americas', 'id': 7 },
        { 'name': 'Armed Forces Canada', 'id': 8 },
        { 'name': 'Armed Forces Europe', 'id': 9 },
        { 'name': 'Armed Forces Middle East', 'id': 10 },
        { 'name': 'Armed Forces Pacific', 'id': 11 },
        { 'name': 'California', 'id': 12 },
        { 'name': 'Colorado', 'id': 13 },
        { 'name': 'Connecticut', 'id': 14 },
        { 'name': 'Delaware', 'id': 15 },
        { 'name': 'District of Columbia', 'id': 16 },
        { 'name': 'Federated States Of Micronesia', 'id': 17 },
        { 'name': 'Florida', 'id': 18 },
        { 'name': 'Georgia', 'id': 19 },
        { 'name': 'Guam', 'id': 20 },
        { 'name': 'Hawaii', 'id': 21 },
        { 'name': 'Idaho', 'id': 22 },
        { 'name': 'Illinois', 'id': 23 },
        { 'name': 'Indiana', 'id': 24 },
        { 'name': 'Iowa', 'id': 25 },
        { 'name': 'Kansas', 'id': 26 },
        { 'name': 'Kentucky', 'id': 27 },
        { 'name': 'Louisiana', 'id': 28 },
        { 'name': 'Maine', 'id': 29 },
        { 'name': 'Marshall Islands', 'id': 30 },
        { 'name': 'Maryland', 'id': 31 },
        { 'name': 'Massachusetts', 'id': 32 },
        { 'name': 'Michigan', 'id': 33 },
        { 'name': 'Minnesota', 'id': 34 },
        { 'name': 'Mississippi', 'id': 35 },
        { 'name': 'Missouri', 'id': 36 },
        { 'name': 'Montana', 'id': 37 },
        { 'name': 'Nebraska', 'id': 38 },
        { 'name': 'Nevada', 'id': 39 },
        { 'name': 'New Hampshire', 'id': 40 },
        { 'name': 'New Jersey', 'id': 41 },
        { 'name': 'New Mexico', 'id': 42 },
        { 'name': 'New York', 'id': 43 },
        { 'name': 'North Carolina', 'id': 44 },
        { 'name': 'North Dakota', 'id': 45 },
        { 'name': 'Northern Mariana Islands', 'id': 46 },
        { 'name': 'Ohio', 'id': 47 },
        { 'name': 'Oklahoma', 'id': 48 },
        { 'name': 'Oregon', 'id': 49 },
        { 'name': 'Palau', 'id': 50 },
        { 'name': 'Pennsylvania', 'id': 51 },
        { 'name': 'Puerto Rico', 'id': 52 },
        { 'name': 'Rhode Island', 'id': 53 },
        { 'name': 'South Carolina', 'id': 54 },
        { 'name': 'South Dakota', 'id': 55 },
        { 'name': 'Tennessee', 'id': 56 },
        { 'name': 'Texas', 'id': 57 },
        { 'name': 'Utah', 'id': 58 },
        { 'name': 'Vermont', 'id': 59 },
        { 'name': 'Virgin Islands', 'id': 60 },
        { 'name': 'Virginia', 'id': 61 },
        { 'name': 'Washington', 'id': 62 },
        { 'name': 'West Virginia', 'id': 63 },
        { 'name': 'Wisconsin', 'id': 64 },
        { 'name': 'Wyoming', 'id': 65 },
      ],
    }

    const state = statesData.states.find(s => s.name.toLowerCase() === stateName.toLowerCase())
    return state ? state.id : false
  }

}

module.exports = TaxController
