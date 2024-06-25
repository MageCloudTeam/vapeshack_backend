const shopify = require('../services/shopify')

class TaxController {

  static async calculateTaxes (_req, res) {

    const { lineItems, stateId } = _req.body
    const taxes = await TaxController.calculateExciseTax(lineItems, stateId)
    res.json(taxes).send()
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

  static async calculateExciseTax (items, stateId) {

    let amount = 0
    const taxValueArr = this.#getStateTaxPrice(stateId)

    if (Object.keys(taxValueArr).length === 0) {
      return amount
    }

    for (const item of items) {
      let qty = 1
      let exciseTaxPercent = 0
      let exciseTaxValue = 0
      let exciseVolumeBase = 0
      let exciseRetailBase = 0
      let exciseOnlyVolume = 0

      const resp = await shopify.getProductDataById(item.product_id)
      const product = resp.product
      const variant = this.#findVariantById(product,item.variant_id)
      const endType = this.#findMetafieldValueByKey(product,'ends-type')
      const juiceType =this.#findMetafieldValueByKey(product,'juice-type')
      const juiceVolume = parseFloat(this.#findMetafieldValueByKey(product,'juice-volume-ml'))
      const juiceCartridgeType = this.#findMetafieldValueByKey(product,'juice-cartridge-type')
      // Do not charge excise tax on 0 nicotine products in CA
      if (stateId === 12 && endType === 'NoNicotine') {
        continue
      }
      const cost = parseFloat(variant?.inventoryItem?.unitCost?.amount||0)
      const itemParent = item
      qty = itemParent.quantity
      const itemPrice = itemParent.price/100

      if ([23, 32, 34, 51].includes(stateId)) {
        if (taxValueArr.wholesale && cost) {
          amount += ((cost * taxValueArr.wholesale / 100) * qty)
          itemParent.exciseTax = (cost * taxValueArr.wholesale / 100) * qty
        }
      } else {

        if (juiceType === 'Open') {
          exciseTaxPercent = taxValueArr.open
        } else if (juiceType === 'Closed') {
          if ([39, 12].includes(stateId)) {
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
        if (exciseTaxPercent === 0 && stateId === 12) {
          exciseTaxPercent = taxValueArr.open
        }
        // Volume Base
        if (exciseVolumeBase && juiceVolume) {
          amount += (juiceVolume * exciseVolumeBase * qty)
          itemParent.exciseTax = (juiceVolume * exciseVolumeBase * qty)
        } else if (exciseRetailBase && itemPrice && exciseTaxPercent) {
          console.log(itemPrice)
          amount += ((itemPrice * exciseTaxPercent / 100) * qty)
          itemParent.exciseTax = (itemPrice * exciseTaxPercent / 100) * qty
        } else if (exciseOnlyVolume && juiceVolume) {
          let exciseAmt = 0
          if (juiceType === 'Open') {


            exciseAmt = taxValueArr.open
          } else if (juiceType === 'Closed') {
            exciseAmt = taxValueArr.close
          }
          amount += (juiceVolume * exciseAmt * qty)
          itemParent.exciseTax = (juiceVolume * exciseAmt * qty)
        } else {
          // Open
          if (cost && exciseTaxPercent) {
            amount += ((cost * exciseTaxPercent / 100) * qty)
            itemParent.exciseTax = (cost * exciseTaxPercent / 100) * qty
          }

          // Closed
          if (exciseTaxValue && juiceVolume) {
            amount += (juiceVolume * exciseTaxValue * qty)
            itemParent.exciseTax = (juiceVolume * exciseTaxValue * qty)
          }
        }
      }
    }
    return amount
  }

  static  #findMetafieldValueByKey(product, searchKey) {
    const edges = product?.metafields?.edges;

    for (const edge of edges) {
      const { key, value } = edge.node;
      if (key === searchKey) {
        return value;
      }
    }

    return false;
  }

  static #findVariantById(product, variantId) {
    const nodes = product.variants.nodes;

    for (const node of nodes) {
      if (node.id.replace('gid://shopify/ProductVariant/','') == variantId) {
        return node;
      }
    }

    return null;
  }
}

module.exports = TaxController
