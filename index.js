const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { ethers } = require('ethers');
const config = require('./config.json');
const fs = require('fs');

// Gunakan plugin stealth agar tidak terdeteksi bot
puppeteer.use(StealthPlugin());

// Helper function untuk delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  console.log('🚀 Memulai Auto Claim Faucet Sepolia...\n');
  
  // Baca Private Keys dari file pk.txt
  let privateKeys = [];
  try {
      if (fs.existsSync('./pk.txt')) {
          const pkFile = fs.readFileSync('./pk.txt', 'utf8');
          privateKeys = pkFile.split('\n').map(line => line.trim()).filter(line => line.length > 0 && line.startsWith('0x'));
      } else {
          console.error('❌ File pk.txt tidak ditemukan!');
          process.exit(1);
      }
  } catch (err) {
      console.error('❌ Gagal membaca pk.txt:', err.message);
      process.exit(1);
  }
  
  if (privateKeys.length === 0) {
      console.error('❌ Tidak ada Private Key valid di dalam pk.txt (pastikan diawali 0x)');
      process.exit(1);
  }
  
  if (!fs.existsSync('./user_data')) {
    fs.mkdirSync('./user_data');
  }

  const browserArgs = [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--window-size=1280,720',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
  ];
  
  if (config.useProxy && config.proxyUrl) {
      browserArgs.push(`--proxy-server=${config.proxyUrl}`);
      console.log(`🌐 Menggunakan Proxy: ${config.proxyUrl}`);
  }

  const os = require('os');
  
  const launchOptions = {
    headless: true, // <-- Bekerja 100% otomatis di belakang layar (background)
    userDataDir: './user_data', 
    args: browserArgs
  };

  // Deteksi OS otomatis: Jika di Windows pakai Chrome asli, jika di VPS pakai yang tersedia
  if (os.platform() === 'win32') {
      launchOptions.executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  } else if (os.platform() === 'linux') {
      if (fs.existsSync('/usr/bin/google-chrome')) {
          launchOptions.executablePath = '/usr/bin/google-chrome';
      } else if (fs.existsSync('/usr/bin/google-chrome-stable')) {
          launchOptions.executablePath = '/usr/bin/google-chrome-stable';
      } else if (fs.existsSync('/usr/bin/chromium-browser')) {
          launchOptions.executablePath = '/usr/bin/chromium-browser';
      } else if (fs.existsSync('/usr/bin/chromium')) {
          launchOptions.executablePath = '/usr/bin/chromium';
      }
      // Jika tidak ada path di atas yang cocok di VPS, Puppeteer akan mencoba 
      // menggunakan Chromium bawaan yang terdownload saat 'npm install'
  }

  const browser = await puppeteer.launch(launchOptions);

  const page = await browser.newPage();
  
  if (config.useProxy && config.proxyUsername && config.proxyPassword) {
      await page.authenticate({
          username: config.proxyUsername,
          password: config.proxyPassword
      });
  }
  
  // Set viewport
  await page.setViewport({ width: 1280, height: 720 });

  for (let i = 0; i < privateKeys.length; i++) {
    const pk = privateKeys[i];
    const walletObj = new ethers.Wallet(pk);
    const walletAddress = walletObj.address;
    console.log(`⏳ [${i + 1}/${privateKeys.length}] Memproses wallet: ${walletAddress}`);
    
    try {
      await page.goto(config.faucetUrl, { waitUntil: 'networkidle2' });
      
      console.log('🔍 Menunggu halaman termuat dan mencari input address...');
      
      // Tunggu form input address muncul. 
      // Selector ini dibuat cukup umum, tapi mungkin perlu disesuaikan dengan web faucet spesifik
      const inputSelector = 'input[placeholder*="ETH"], input[placeholder*="address"], input[name="address"]'; 
      
      try {
          await page.waitForSelector(inputSelector, { timeout: 15000 });
      } catch (err) {
          console.log('⚠️ Input address tidak ditemukan dalam 15 detik.');
          console.log('💡 Jika Anda menggunakan Alchemy Faucet (sepoliafaucet.com), Anda WAJIB login menggunakan akun Alchemy (Google/Email) secara MANUAL pada jendela browser ini terlebih dahulu.');
          console.log('💡 Browser akan menunggu selama 60 detik. Silakan login sekarang jika belum.');
          await delay(60000); // Beri waktu 1 menit untuk login manual
      }

      const inputEl = await page.$(inputSelector);
      
      if (inputEl) {
        console.log('✍️ Memasukkan wallet address...');
        // Hapus value sebelumnya (jika ada)
        await inputEl.click({ clickCount: 3 });
        await inputEl.press('Backspace');
        
        // Ketik wallet address perlahan agar terlihat natural
        await page.type(inputSelector, walletAddress, { delay: 50 });
        
        // Beri sedikit jeda sebelum mengeklik tombol
        await delay(3000);
        
        console.log('🔎 Mencari tombol "Start Mining"...');
        const buttons = await page.$$('button');
        let startClicked = false;
        
        for (const btn of buttons) {
          const text = await page.evaluate(el => el.textContent, btn);
          if (text.toLowerCase().includes('start mining')) {
            await btn.click();
            startClicked = true;
            break;
          }
        }
        
        if (startClicked) {
          console.log(`⛏️ Mining dimulai untuk ${walletAddress}!`);
          const durationMs = (config.miningDurationMinutes || 30) * 60 * 1000;
          console.log(`⏳ Bot akan diam dan membiarkan penambangan berjalan di background selama ${config.miningDurationMinutes} menit... (Jangan matikan script)`);
          
          // Tunggu selama durasi mining
          await delay(durationMs);
          
          console.log('🛑 Waktu mining selesai. Mencari tombol "Stop Mining & Claim Rewards"...');
          const stopButtons = await page.$$('button, a.btn, a[role="button"], div.btn, input[type="button"]');
          let stopClicked = false;
          
          for (const btn of stopButtons) {
            const text = await page.evaluate(el => el.textContent || el.value || '', btn);
            if (text.toLowerCase().includes('stop mining') || text.toLowerCase().includes('claim reward') || text.toLowerCase().includes('claim')) {
              await btn.click();
              stopClicked = true;
              break;
            }
          }
          
          if (stopClicked) {
             console.log(`🎉 Berhasil mengklaim hasil mining untuk ${walletAddress}!`);
             await delay(15000); // Tunggu konfirmasi claim
          } else {
             console.log('❌ Tombol "Stop Mining" tidak ditemukan.');
          }

        } else {
          console.log('❌ Tombol "Start Mining" tidak ditemukan. (Mungkin selector/teks tombol berbeda)');
        }

      }
      
    } catch (error) {
      console.error(`❌ Terjadi kesalahan pada wallet ${walletAddress}:`, error.message);
    }
    
    // Jeda sebelum lanjut ke wallet berikutnya (hindari rate limit)
    if (i < privateKeys.length - 1) {
      console.log(`⏱️ Menunggu ${config.delayBetweenClaimsMs / 1000} detik sebelum lanjut ke wallet berikutnya...`);
      await delay(config.delayBetweenClaimsMs);
    }
  }
  
  console.log('\n🏁 Semua proses mining telah selesai. Menutup browser...');
  await browser.close();

  console.log('\n🔄 Memulai proses SWEEP (Transfer Saldo ke Wallet Utama)...');
  
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  
  for (let i = 0; i < privateKeys.length; i++) {
     const pk = privateKeys[i];
     const walletObj = new ethers.Wallet(pk, provider);
     
     try {
         const balance = await provider.getBalance(walletObj.address);
         console.log(`\n💰 Mengecek Saldo ${walletObj.address}: ${ethers.formatEther(balance)} ETH`);
         
         if (balance > 0n) {
             const feeData = await provider.getFeeData();
             const gasLimit = 21000n; // Standard transfer gas limit
             const gasPrice = feeData.gasPrice;
             const txFee = gasPrice * gasLimit;
             
             if (balance > txFee) {
                 const amountToSend = balance - txFee;
                 console.log(`💸 Mengirim ${ethers.formatEther(amountToSend)} ETH ke ${config.mainWalletAddress}...`);
                 
                 const tx = await walletObj.sendTransaction({
                     to: config.mainWalletAddress,
                     value: amountToSend,
                     gasLimit: gasLimit,
                     gasPrice: gasPrice
                 });
                 
                 console.log(`✅ Transaksi terkirim! Hash: ${tx.hash}`);
                 await tx.wait();
                 console.log(`🎉 Transaksi sukses dikonfirmasi di blockchain!`);
             } else {
                 console.log(`⚠️ Saldo tidak cukup untuk membayar Gas Fee (Fee: ${ethers.formatEther(txFee)} ETH)`);
             }
         } else {
             console.log(`⏭️ Saldo kosong, melewati...`);
         }
     } catch (err) {
         console.error(`❌ Gagal mentransfer dari ${walletObj.address}: ${err.message}`);
     }
  }
  
  console.log('\n🎉 SELURUH PROSES FARMING & SWEEP SELESAI!');
})();
