const shopifyClient = require('shopify-api-node')

class Shopify {
  static async #createRequest (query, params) {
    const shopify = new shopifyClient({
      shopName: process.env.SHOPIFY_STORE_NAME,
      apiKey: process.env.SHOPIFY_API_KEY,
      password: process.env.SHOPIFY_API_PASSWORD,
    })
    try {
      return await shopify.graphql(query, params)
    } catch (e) {
      console.log(e)
      return false
    }
  }

  static async getProductDataById (productId) {
    const GET_PRODUCT_VARIANTS = `
    query getVariants($id: ID!) {
        product(id: $id) {
        id
        handle
       
          metafields(first:20 namespace:"custom" ) {
                     edges {
                         node {
                             namespace
                              key
                              value
                          }
                     }
                 }
          variants(first: 100) {
            nodes {
              id
              displayName
              price
              inventoryItem{
              unitCost {
              amount
              }
              }
            }
          }
        }
      }`

    try {
      return await this.#createRequest(GET_PRODUCT_VARIANTS, {
        id: `gid://shopify/Product/${productId}`,
      })
    } catch (e) {
      console.log(e)
      return false
    }
  }
}

module.exports = Shopify
