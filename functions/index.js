const functions = require('firebase-functions');
const playwright = require('playwright');
const axios = require('axios');
const { Parser } = require('json2csv');

exports.scrapingProductsForLJV = functions.runWith({timeoutSeconds: 540}).https.onRequest(async (req, res) => {
  
    const browserType = 'webkit'; //'webkit' or 'chromium' available
    const browser = await playwright[browserType].launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    //await page.route('**/*', (route) => {
    //    return route.request().resourceType() === 'image'
    //      ? route.abort()
    //      : route.continue()
    //  })

    const errorLogs = []
    page.on("console", (message) => {
        if (message.type() === "error") {
          errorLogs.push(message.text())
        }
      })

    const rootPages = [
        'https://www.un-ours-et-les-etoiles.fr/03-ans-xsl-352.html',
        //'https://www.un-ours-et-les-etoiles.fr/les-petits-312-ans-xsl-353.html'
    ]
    let listOfTopPages = []

    for (let i = 0; i < rootPages.length; i++) {
        await page.goto(rootPages[i]); 
        //await page.waitForNavigation({ waitUntil: 'networkidle' });
        const links = await page.evaluate(() => {

            const categories = document.querySelectorAll('div.td-souscat-nom > a')            
            return Array.from(categories).map(c => c.href)
        });
        listOfTopPages = listOfTopPages.concat(links)

    }

    let toys = []
    for (let j = 0; j < listOfTopPages.length; j++) {
        console.log('Navigating to TOP page : '+listOfTopPages[j])
        await page.goto(listOfTopPages[j]);

        const data = await page.evaluate(() => {

            const elts = document.querySelectorAll('div.la_description_wrapper')
            const details = Array.from(elts).map(
                function(v) {

                    let product_id = '' 
                    let product_url = ''

                    if(v.querySelector('td.boxe-la-haut > a.img_products') != null){
                        product_url = v.querySelector('td.boxe-la-haut > a.img_products').href
                        let url_parts = product_url.split('-');
                        product_id = url_parts.at(-1).split('.')[0];
                    }

                    let product_title = ''
                    let product_brand = ''
                    let product_image = ''

                    if(v.querySelector('td.boxe-la-milieu a.titreproduitliste') != null){
                        product_title = v.querySelector('td.boxe-la-milieu a.titreproduitliste').innerText
                    }

                    if(v.querySelector('td.boxe-la-haut img') != null){
                        product_image = 'https://' + document.domain + '/' + v.querySelector('td.boxe-la-haut img').getAttribute('data-src')
                    }

                    let product_price = ''
                    if(v.querySelector('td.boxe-la-bas .prix') != null){
                        product_price = v.querySelector('td.boxe-la-bas .prix').innerText.replace(/ €/, '')
                    }

                    let product_reference = ''
                    let product_availability = ''
                    let product_stock = 0


                    return {
                        'product_id':           product_id, 
                        'product_reference':    product_reference,
                        'product_title':        product_title,
                        'product_availability': product_availability,
                        'product_stock':        product_stock,
                        'product_brand':        product_brand,
                        'product_price':        product_price,
                        'product_url':          product_url,
                        'product_image':        product_image
                    }
                });
                return details;
            });

        toys = toys.concat(data)
    }

    for (let k = 0; k < 10/*toys.length*/; k++) {
        
        if(toys[k]['product_url'] != ''){
            
            let product_url = toys[k]['product_url']
            console.log(k+' - Navigating to (DETAILS) : '+product_url)
            await page.goto(product_url);

            try{
                let product_details = null;
                product_details = await page.evaluate(() => {

                    const pd_ref = document.querySelector('.mod_fa_reference').innerText.replace('-','').trim()
                    const pd_availability = (document.querySelector('#fa_stock > img').getAttribute('alt').toLowerCase() == 'en stock') ? true : false
                    const pd_brand = document.querySelector('div.mod_fa_marque > span').innerText.toUpperCase().trim()

                    let pd_stock = 0

                    return {
                        'pd_ref':pd_ref,
                        'pd_availability':pd_availability,
                        'pd_brand':pd_brand,
                        'pd_stock':pd_stock
                    }
                })
                //console.log('==============INFOS==============')
                //console.log(product_details['pd_brand'])
                //console.log(product_details['pd_ref'])
                //console.log(product_details['pd_availability'])

                if(product_details['pd_availability']){
                    let stock_response
                    let test = 0
                    for (let c = 1; c < 15; c++) {
                        stock_response = 0
                        stock_response =  await axios({
                            method: 'post',
                            url: 'https://www.un-ours-et-les-etoiles.fr/ajax.php?page=fa', //'https://httpbin.org/post',
                            headers: {
                                //'Content-Type': 'application/x-www-form-urlencoded',
                                //'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:92.0) Gecko/20100101 Firefox/92.0',
                                //'X-Requested-With': 'XMLHttpRequest',
                                //'Accept': '*/*'
                            },
                            data: "action=updateStock&data=quantity%3D"+c+"%26products_id%3D"+toys[k]['product_id']
                        }).then(function (response) {
                            //console.log(response.data)
                            if(response.data.indexOf("$('#fa_btn_acheter:hidden').show();") > 0){
                                return 1
                            }else{
                                return 0
                            }
                        })
                        //console.log('stock_response', stock_response)
                        product_details['pd_stock']+=stock_response

                    }
                }
                //console.log('here')

                toys[k]['product_reference'] = product_details['pd_ref']
                toys[k]['product_availability'] = product_details['pd_availability']
                toys[k]['product_brand'] = product_details['pd_brand']
                toys[k]['product_stock'] = product_details['pd_stock']
            }catch(error){
                console.error(error)
            }            
        } 
    }
    //console.log(toys)

    
    //console.log('Output : ', errorLogs)
    await browser.close();
    //console.log(data);
    // Return the data in form of json
    //return res.status(200).json(toys);

    const fields = ['product_id', 'product_reference', 'product_title', 'product_availability', 'product_stock', 'product_brand', 'product_price', 'product_url', 'product_image'];
    const fieldNames = ['Id', 'Reference', 'Title', 'Availability', 'Stock', 'Brand', 'Price', 'Url', 'Image'];
    //const data = await json2csv({ data: toys, fields: fields, fieldNames: fieldNames });

    const opts = { fieldNames };
    
    try {
      const parser = new Parser(opts);
      const csv = parser.parse(toys);
      console.log(csv);
      res.attachment('toys.csv');
      res.status(200).send(csv);
    } catch (err) {
      console.error(err);
    }



    
}); 