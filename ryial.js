const sqlite3 = require('sqlite3').verbose();
const TelegramBot = require('node-telegram-bot-api');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const QrCode = require('qrcode-reader');

// إعداد قاعدة البيانات
const db = new sqlite3.Database('./wallet.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    username TEXT,
    balance INTEGER DEFAULT 1000,
    wallet_address TEXT UNIQUE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    recipient_id INTEGER,
    amount INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS beneficiaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    wallet_address TEXT
  )`);
});

// إعداد البوت
const token = '7359966663:AAHGrBoaBKs8Fodwrl8I8fCBXWfC9KVm1Qw';
const bot = new TelegramBot(token, { polling: true });

const initial_balance = 1000;
const fee = 1;
const feeWalletAddress = '5a6116d1d3df220f46bd5acfa318d6';

// إرسال القائمة الرئيسية
const sendMainMenu = (chatId, text) => {
  const options = {
    reply_markup: {
      keyboard: [
        [{ text: 'عرض الرصيد' }, { text: 'إرسال المال' }],
        [{ text: 'عرض عنوان المحفظة' }, { text: 'عرض سجل العمليات' }],
        [{ text: 'جهات الارسال' }, { text: 'إدارة جهات الإرسال' }],
        [{ text: 'إنشاء QRcode' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
  bot.sendMessage(chatId, text, options);
};

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username;

  db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
    if (err) {
      return bot.sendMessage(chatId, 'حدث خطأ.');
    }

    if (!row) {
      const walletAddress = [...Array(30)].map(() => Math.random().toString(36)[2]).join('');

      db.run('INSERT INTO users (user_id, username, wallet_address, balance) VALUES (?, ?, ?, ?)', [userId, username, walletAddress, initial_balance], (err) => {
        if (err) {
          return bot.sendMessage(chatId, 'حدث خطأ أثناء إنشاء حسابك.');
        }

        sendMainMenu(chatId, `مرحبًا بك في المحفظة الرقمية! عنوان محفظتك هو: ${walletAddress}. تم إضافة ${initial_balance} ريال إلى رصيدك.`);
      });
    } else {
      sendMainMenu(chatId, 'مرحبًا بعودتك إلى المحفظة الرقمية!');
    }
  });
});

const handleReturnToMainMenu = (chatId) => {
  sendMainMenu(chatId, 'عدت إلى القائمة الرئيسية.');
};

// عرض الرصيد
bot.onText(/عرض الرصيد/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  db.get('SELECT balance FROM users WHERE user_id = ?', [userId], (err, row) => {
    if (err || !row) {
      return bot.sendMessage(chatId, 'حدث خطأ أو أنك غير مسجل.');
    }
    bot.sendMessage(chatId, `رصيدك الحالي هو: ${row.balance} ريال.`);
  });
});

// عرض عنوان المحفظة
bot.onText(/عرض عنوان المحفظة/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  db.get('SELECT wallet_address FROM users WHERE user_id = ?', [userId], (err, row) => {
    if (err || !row) {
      return bot.sendMessage(chatId, 'حدث خطأ أو أنك غير مسجل.');
    }
    bot.sendMessage(chatId, `عنوان محفظتك هو: ${row.wallet_address}`);
  });
});


// عرض سجل العمليات
bot.onText(/عرض سجل العمليات/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const query = `
    SELECT t.*, su.wallet_address AS sender_wallet, ru.wallet_address AS recipient_wallet
    FROM transactions t
    JOIN users su ON t.sender_id = su.user_id
    JOIN users ru ON t.recipient_id = ru.user_id
    WHERE t.sender_id = ? OR t.recipient_id = ?
    ORDER BY t.timestamp DESC
  `;

  db.all(query, [userId, userId], (err, rows) => {
    if (err || !rows.length) {
      return bot.sendMessage(chatId, 'لم تقم بإجراء أي عمليات بعد.');
    }

    const transactionsList = rows.map(row => {
      const date = new Date(row.timestamp);
      const formattedDate = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
      const type = row.sender_id === userId ? 'إرسال' : 'استلام';
      const otherPartyWallet = row.sender_id === userId ? row.recipient_wallet : row.sender_wallet;
      return `${formattedDate}: ${type} ${row.amount} ريال إلى/من ${otherPartyWallet}`;
    });

    bot.sendMessage(chatId, 'جميع العمليات:');
    bot.sendMessage(chatId, transactionsList.join('\n'));
  });
});


// جهات الارسال
bot.onText(/جهات الارسال/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  db.all('SELECT * FROM beneficiaries WHERE user_id = ?', [userId], (err, rows) => {
    if (err || !rows.length) {
      return bot.sendMessage(chatId, 'لم تقم بإضافة أي مستفيدين بعد.');
    }

    const beneficiariesList = rows.map(row => row.name);
    bot.sendMessage(chatId, 'مستفيدينك:');
    bot.sendMessage(chatId, beneficiariesList.join('\n'));
  });
});

// إدارة جهات الإرسال
bot.onText(/إدارة جهات الإرسال/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const options = {
    reply_markup: {
      keyboard: [
        [{ text: 'إضافة مستفيد جديد' }],
        [{ text: 'حذف مستفيد' }],
        [{ text: 'عوده إلى القائمة الرئيسية' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
  bot.sendMessage(chatId, 'اختر الإجراء:', options);

  const returnToMainHandler = (msg) => {
    if (msg.text === 'عوده إلى القائمة الرئيسية') {
      handleReturnToMainMenu(chatId);
      return true;
    }
    return false;
  };

  bot.once('message', (msg) => {
    if (returnToMainHandler(msg)) return;

    if (msg.text === 'إضافة مستفيد جديد') {
      bot.sendMessage(chatId, 'أدخل اسم المستفيد:');
      bot.once('message', (msg) => {
        if (returnToMainHandler(msg)) return;

        const name = msg.text;
        bot.sendMessage(chatId, 'أدخل عنوان المحفظة للمستفيد:');
        bot.once('message', (msg) => {
          if (returnToMainHandler(msg)) return;

          const walletAddress = msg.text;
          db.run('INSERT INTO beneficiaries (user_id, name, wallet_address) VALUES (?, ?, ?)', [userId, name, walletAddress], (err) => {
            if (err) {
              return bot.sendMessage(chatId, 'حدث خطأ أثناء إضافة المستفيد.');
            }
            bot.sendMessage(chatId, 'تم إضافة المستفيد بنجاح.');
            handleReturnToMainMenu(chatId);
          });
        });
      });
    } else if (msg.text === 'حذف مستفيد') {
      db.all('SELECT * FROM beneficiaries WHERE user_id = ?', [userId], (err, rows) => {
        if (err || !rows.length) {
          return bot.sendMessage(chatId, 'لم تقم بإضافة أي مستفيدين بعد.');
        }

        const options = {
          reply_markup: {
            keyboard: rows.map(row => [{ text: row.name }]).concat([[{ text: 'عوده إلى القائمة الرئيسية' }]]),
            resize_keyboard: true,
            one_time_keyboard: true
          }
        };
        bot.sendMessage(chatId, 'اختر المستفيد لحذفه:', options);

        bot.once('message', (msg) => {
          if (returnToMainHandler(msg)) return;

          const beneficiary = rows.find(row => row.name === msg.text);

          if (beneficiary) {
            db.run('DELETE FROM beneficiaries WHERE id = ?', [beneficiary.id], (err) => {
              if (err) {
                return bot.sendMessage(chatId, 'حدث خطأ أثناء حذف المستفيد.');
              }
              bot.sendMessage(chatId, 'تم حذف المستفيد بنجاح.');
              handleReturnToMainMenu(chatId);
            });
          } else {
            bot.sendMessage(chatId, 'لم يتم العثور على المستفيد');
          }
        });
      });
    }
  });
});

// إنشاء QRcode
const generateAndSendQRCode = (chatId, walletAddress) => {
  const filePath = path.join(__dirname, 'qrcodes', `${walletAddress}.png`);
  qrcode.toFile(filePath, walletAddress, (err) => {
    if (err) {
      return bot.sendMessage(chatId, 'حدث خطأ أثناء إنشاء QR code.');
    }
    bot.sendPhoto(chatId, filePath, { caption: 'هذا هو QR code الخاص بمحفظتك.' });
  });
};

bot.onText(/إنشاء QRcode/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  db.get('SELECT wallet_address FROM users WHERE user_id = ?', [userId], (err, row) => {
    if (err || !row) {
      return bot.sendMessage(chatId, 'حدث خطأ أو أنك غير مسجل.');
    }
    generateAndSendQRCode(chatId, row.wallet_address);
  });
});

// إرسال المال
bot.onText(/إرسال المال/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const options = {
    reply_markup: {
      keyboard: [
        [{ text: 'إرسال إلى عنوان محفظة' }],
        [{ text: 'إرسال إلى مستفيد مسجل' }],
        [{ text: 'عوده إلى القائمة الرئيسية' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  };
  bot.sendMessage(chatId, 'اختر طريقة الإرسال:', options);

  const returnToMainHandler = (msg) => {
    if (msg.text === 'عوده إلى القائمة الرئيسية') {
      handleReturnToMainMenu(chatId);
      return true;
    }
    return false;
  };

  bot.once('message', (msg) => {
    if (returnToMainHandler(msg)) return;

    if (msg.text === 'إرسال إلى عنوان محفظة') {
      bot.sendMessage(chatId, 'أدخل عنوان المحفظة:');
      bot.once('message', (msg) => {
        if (returnToMainHandler(msg)) return;

        const recipientAddress = msg.text;
        bot.sendMessage(chatId, 'أدخل المبلغ لإرساله:');
        bot.once('message', (msg) => {
          if (returnToMainHandler(msg)) return;

          const amount = parseInt(msg.text);

          db.get('SELECT * FROM users WHERE wallet_address = ?', [recipientAddress], (err, recipient) => {
            if (err || !recipient) {
              return bot.sendMessage(chatId, 'عنوان المحفظة غير موجود.');
            }

            db.get('SELECT balance FROM users WHERE user_id = ?', [userId], (err, sender) => {
              if (err || !sender) {
                return bot.sendMessage(chatId, 'حدث خطأ أو أنك غير مسجل.');
              }

              if (sender.balance < amount + fee) {
                return bot.sendMessage(chatId, 'لا يوجد رصيد كافي لإتمام المعاملة.');
              }

              db.run('UPDATE users SET balance = balance - ? WHERE user_id = ?', [amount + fee, userId], (err) => {
                if (err) {
                  return bot.sendMessage(chatId, 'حدث خطأ أثناء إرسال المال.');
                }

                db.run('UPDATE users SET balance = balance + ? WHERE wallet_address = ?', [amount, recipientAddress], (err) => {
                  if (err) {
                    return bot.sendMessage(chatId, 'حدث خطأ أثناء استلام المال.');
                  }

                  db.run('UPDATE users SET balance = balance + ? WHERE wallet_address = ?', [fee, feeWalletAddress], (err) => {
                    if (err) {
                      return bot.sendMessage(chatId, 'حدث خطأ أثناء خصم العمولة.');
                    }

                    db.run('INSERT INTO transactions (sender_id, recipient_id, amount) VALUES (?, ?, ?)', [userId, recipient.id, amount], (err) => {
                      if (err) {
                        return bot.sendMessage(chatId, 'حدث خطأ أثناء تسجيل المعاملة.');
                      }

                      bot.sendMessage(chatId, `تم إرسال ${amount} ريال إلى ${recipient.username}. تم خصم ${fee} ريال كعمولة.`);
                      bot.sendMessage(recipient.user_id, `لقد استلمت ${amount} ريال من ${msg.from.username}.`);
                      handleReturnToMainMenu(chatId);
                    });
                  });
                });
              });
            });
          });
        });
      });
    } else if (msg.text === 'إرسال إلى مستفيد مسجل') {
      db.all('SELECT * FROM beneficiaries WHERE user_id = ?', [userId], (err, rows) => {
        if (err || !rows.length) {
          return bot.sendMessage(chatId, 'لم تقم بإضافة أي مستفيدين بعد.');
        }

        const options = {
          reply_markup: {
            keyboard: rows.map(row => [{ text: row.name }]).concat([[{ text: 'عوده إلى القائمة الرئيسية' }]]),
          resize_keyboard: true,
          one_time_keyboard: true
        }
        };
        bot.sendMessage(chatId, 'اختر المستفيد:', options);

        bot.once('message', (msg) => {
          if (returnToMainHandler(msg)) return;

          const beneficiary = rows.find(row => row.name === msg.text);

          if (beneficiary) {
            bot.sendMessage(chatId, 'أدخل المبلغ لإرساله:');
            bot.once('message', (msg) => {
              if (returnToMainHandler(msg)) return;

              const amount = parseInt(msg.text);

              db.get('SELECT balance FROM users WHERE user_id = ?', [userId], (err, sender) => {
                if (err || !sender) {
                  return bot.sendMessage(chatId, 'حدث خطأ أو أنك غير مسجل.');
                }

                if (sender.balance < amount + fee) {
                  return bot.sendMessage(chatId, 'لا يوجد رصيد كافي لإتمام المعاملة.');
                }

                db.run('UPDATE users SET balance = balance - ? WHERE user_id = ?', [amount + fee, userId], (err) => {
                  if (err) {
                    return bot.sendMessage(chatId, 'حدث خطأ أثناء إرسال المال.');
                  }

                  db.get('SELECT * FROM users WHERE wallet_address = ?', [beneficiary.wallet_address], (err, recipient) => {
                    if (err || !recipient) {
                      return bot.sendMessage(chatId, 'حدث خطأ أثناء العثور على المستلم.');
                    }

                    db.run('UPDATE users SET balance = balance + ? WHERE wallet_address = ?', [amount, beneficiary.wallet_address], (err) => {
                      if (err) {
                        return bot.sendMessage(chatId, 'حدث خطأ أثناء استلام المال.');
                      }

                      db.run('UPDATE users SET balance = balance + ? WHERE wallet_address = ?', [fee, feeWalletAddress], (err) => {
                        if (err) {
                          return bot.sendMessage(chatId, 'حدث خطأ أثناء خصم العمولة.');
                        }

                        db.run('INSERT INTO transactions (sender_id, recipient_id, amount) VALUES (?, ?, ?)', [userId, recipient.id, amount], (err) => {
                          if (err) {
                            return bot.sendMessage(chatId, 'حدث خطأ أثناء تسجيل المعاملة.');
                          }

                          bot.sendMessage(chatId, `تم إرسال ${amount} ريال إلى ${beneficiary.name}. تم خصم ${fee} ريال كعمولة.`);
                          bot.sendMessage(recipient.user_id, `لقد استلمت ${amount} ريال من ${msg.from.username}.`);
                          handleReturnToMainMenu(chatId);
                        });
                      });
                    });
                  });
                });
              });
            });
          } else {
            bot.sendMessage(chatId, 'لم يتم العثور على المستفيد.');
            handleReturnToMainMenu(chatId);
          }
        });
      });
    }
  });
});

bot.on('photo', (msg) => {
  const chatId = msg.chat.id;
  const photoId = msg.photo[msg.photo.length - 1].file_id;

  bot.getFileLink(photoId).then((link) => {
    Jimp.read(link)
      .then((image) => {
        const qr = new QrCode();
        qr.callback = (err, value) => {
          if (err) {
            bot.sendMessage(chatId, 'حدث خطأ أثناء قراءة رمز QR.');
            return;
          }

          const recipientAddress = value.result;
          bot.sendMessage(chatId, `تم استخراج العنوان: ${recipientAddress}`);
          bot.sendMessage(chatId, 'أدخل المبلغ لإرساله:');
          
          bot.once('message', (msg) => {
            const amount = parseInt(msg.text);

            db.get('SELECT * FROM users WHERE wallet_address = ?', [recipientAddress], (err, recipient) => {
              if (err || !recipient) {
                return bot.sendMessage(chatId, 'عنوان المحفظة غير موجود.');
              }

              db.get('SELECT balance FROM users WHERE user_id = ?', [chatId], (err, sender) => {
                if (err || !sender) {
                  return bot.sendMessage(chatId, 'حدث خطأ أو أنك غير مسجل.');
                }

                if (sender.balance < amount + fee) {
                  return bot.sendMessage(chatId, 'لا يوجد رصيد كافي لإتمام المعاملة.');
                }

                db.run('UPDATE users SET balance = balance - ? WHERE user_id = ?', [amount + fee, chatId], (err) => {
                  if (err) {
                    return bot.sendMessage(chatId, 'حدث خطأ أثناء إرسال المال.');
                  }

                  db.run('UPDATE users SET balance = balance + ? WHERE wallet_address = ?', [amount, recipientAddress], (err) => {
                    if (err) {
                      return bot.sendMessage(chatId, 'حدث خطأ أثناء استلام المال.');
                    }

                    db.run('UPDATE users SET balance = balance + ? WHERE wallet_address = ?', [fee, feeWalletAddress], (err) => {
                      if (err) {
                        return bot.sendMessage(chatId, 'حدث خطأ أثناء خصم العمولة.');
                      }

                      db.run('INSERT INTO transactions (sender_id, recipient_id, amount) VALUES (?, ?, ?)', [chatId, recipient.id, amount], (err) => {
                        if (err) {
                          return bot.sendMessage(chatId, 'حدث خطأ أثناء تسجيل المعاملة.');
                        }

                        bot.sendMessage(chatId, `تم إرسال ${amount} ريال إلى ${recipient.username}. تم خصم ${fee} ريال كعمولة.`);
                        bot.sendMessage(recipient.user_id, `لقد استلمت ${amount} ريال من ${msg.from.username}.`);
                        handleReturnToMainMenu(chatId);
                      });
                    });
                  });
                });
              });
            });
          });
        };
        qr.decode(image.bitmap);
      })
      .catch((err) => {
        bot.sendMessage(chatId, 'حدث خطأ أثناء قراءة الصورة.');
      });
  });
});

