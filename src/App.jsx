import React, { useState, useEffect } from 'react';

// --- 配置常量 ---
const LIFT_TOKEN_ADDR = "0x47b93c2a0920BBe10eFc7854b8FD04a02E85d031";
const CONTRACT_ADDR = "0x3Bf7cdf6F993b2f507E48574C646D3d75AEBB994";
const BOX_COUNT = 120;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function decimals() view returns (uint8)"
];
const GAME_ABI = [
  "function openBox(uint256 boxId)",
  "function donate(uint256 boxId, address token, uint256 amount)",
  "function getBoxBalance(uint256 boxId, address token) view returns (uint256)",
  "event BoxOpened(address indexed player, uint256 indexed boxId, address token, uint256 reward)"
];

export default function App() {
  // --- 状态管理 ---
  const [userAddr, setUserAddr] = useState("");
  const [balance, setBalance] = useState("--");
  const [isApproved, setIsApproved] = useState(false);
  const [maxBalance, setMaxBalance] = useState("???");
  const [isScanning, setIsScanning] = useState(false);
  const [ethersLib, setEthersLib] = useState(null); // 存储加载后的 ethers 库
  
  // 合约对象
  const [liftToken, setLiftToken] = useState(null);
  const [gameContract, setGameContract] = useState(null);
  const [signer, setSigner] = useState(null);

  // 弹窗与交互状态
  const [resultModal, setResultModal] = useState({ show: false, amount: "0" });
  const [donateModal, setDonateModal] = useState({ show: false, boxId: 0 });
  const [donateInput, setDonateInput] = useState({ token: LIFT_TOKEN_ADDR, amount: "" });
  const [toast, setToast] = useState({ show: false, msg: "", type: "info" });
  const [shakingBox, setShakingBox] = useState(null);

  // --- 初始化：动态加载 Ethers.js ---
  useEffect(() => {
    if (window.ethers) {
      setEthersLib(window.ethers);
      return;
    }
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.umd.min.js";
    script.async = true;
    script.onload = () => {
      setEthersLib(window.ethers);
    };
    document.body.appendChild(script);
  }, []);

  // --- 辅助函数：显示通知 ---
  const showToast = (msg, type = "info") => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast((prev) => ({ ...prev, show: false })), 3000);
  };

  // --- 连接钱包 ---
  const connectWallet = async () => {
    if (!ethersLib) return showToast("正在加载依赖，请稍后再试...", "warning");
    if (!window.ethereum) return alert("请安装 MetaMask!");
    
    try {
      const provider = new ethersLib.BrowserProvider(window.ethereum);
      const newSigner = await provider.getSigner();
      const addr = await newSigner.getAddress();
      
      setUserAddr(addr);
      setSigner(newSigner);

      const token = new ethersLib.Contract(LIFT_TOKEN_ADDR, ERC20_ABI, newSigner);
      const game = new ethersLib.Contract(CONTRACT_ADDR, GAME_ABI, newSigner);
      
      setLiftToken(token);
      setGameContract(game);
      
      // 立即检查状态
      checkStatus(addr, token, ethersLib);
    } catch (e) {
      console.error(e);
      showToast("连接失败", "error");
    }
  };

  const checkStatus = async (addr, tokenContract, lib) => {
    if (!addr || !tokenContract || !lib) return;
    try {
      // 查余额
      const bal = await tokenContract.balanceOf(addr);
      setBalance(parseFloat(lib.formatEther(bal)).toFixed(2));

      // 查授权：使用 BigInt() 构造函数替代 10000n 字面量
      const allowance = await tokenContract.allowance(addr, CONTRACT_ADDR);
      // 10000 * 10^18
      const threshold = BigInt(10000) * (BigInt(10) ** BigInt(18));
      setIsApproved(allowance > threshold);
    } catch (e) {
      console.error("Check status failed", e);
    }
  };

  // --- 核心交互 ---
  const approveToken = async () => {
    if (!liftToken || !ethersLib) return;
    try {
      showToast("⏳ 正在授权...", "info");
      const tx = await liftToken.approve(CONTRACT_ADDR, ethersLib.MaxUint256);
      await tx.wait();
      showToast("✅ 授权成功！", "success");
      checkStatus(userAddr, liftToken, ethersLib);
    } catch (e) {
      showToast("❌ 授权失败", "error");
    }
  };

  const scanMaxBalance = async () => {
    if (!gameContract || !ethersLib) return showToast("请先连接钱包", "warning");
    if (isScanning) return;

    setIsScanning(true);
    setMaxBalance("...");
    showToast("🔍 开始扫描全网奖池...", "info");

    try {
      let maxBal = BigInt(0);
      const batchSize = 20; // 批量并发查询
      for (let i = 1; i <= BOX_COUNT; i += batchSize) {
        const promises = [];
        for (let j = i; j < i + batchSize && j <= BOX_COUNT; j++) {
          promises.push(gameContract.getBoxBalance(j, LIFT_TOKEN_ADDR));
        }
        const results = await Promise.all(promises);
        for (const bal of results) {
          if (bal > maxBal) maxBal = bal;
        }
      }
      setMaxBalance(parseFloat(ethersLib.formatEther(maxBal)).toLocaleString(undefined, { maximumFractionDigits: 0 }));
      showToast("🏆 扫描完成！", "success");
    } catch (e) {
      console.error(e);
      setMaxBalance("???");
      showToast("❌ 扫描失败", "error");
    } finally {
      setIsScanning(false);
    }
  };

  const onBoxClick = async (boxId) => {
    if (!gameContract || !ethersLib) return showToast("请先连接钱包", "error");
    if (parseFloat(balance) < 100) return showToast("❌ 余额不足 100 LIFT", "error");
    if (!isApproved) return showToast("❌ 请先点击授权", "error");

    try {
      setShakingBox(boxId); // 触发动画
      const tx = await gameContract.openBox(boxId);
      showToast("⏳ 开箱中...请等待上链", "info");
      
      const receipt = await tx.wait();
      
      // 解析日志找奖励金额
      let rewardAmount = "0";
      for (const log of receipt.logs) {
        try {
          const parsed = gameContract.interface.parseLog(log);
          if (parsed && parsed.name === 'BoxOpened') {
            rewardAmount = ethersLib.formatEther(parsed.args.reward);
            break;
          }
        } catch (e) {}
      }

      setResultModal({ show: true, amount: rewardAmount });
      checkStatus(userAddr, liftToken, ethersLib); // 更新余额
    } catch (e) {
      console.error(e);
      if (e.code === 'ACTION_REJECTED') {
        showToast("❌ 用户取消", "info");
      } else {
        showToast("❌ 开箱失败", "error");
      }
    } finally {
      setShakingBox(null);
    }
  };

  const handleDonate = async () => {
    if (!ethersLib) return;
    const { token, amount } = donateInput;
    if (!ethersLib.isAddress(token)) return showToast("无效代币地址", "error");
    if (!amount || parseFloat(amount) <= 0) return showToast("无效数量", "error");

    try {
      showToast("⏳ 准备投喂...", "info");
      const tokenContract = new ethersLib.Contract(token, ERC20_ABI, signer);
      
      // 获取精度
      let decimals = 18;
      try { decimals = await tokenContract.decimals(); } catch (e) {}
      const parsedAmount = ethersLib.parseUnits(amount, decimals);

      // 检查授权
      const allowance = await tokenContract.allowance(userAddr, CONTRACT_ADDR);
      if (allowance < parsedAmount) {
        showToast("⏳ 请求授权...", "info");
        const txApp = await tokenContract.approve(CONTRACT_ADDR, ethersLib.MaxUint256);
        await txApp.wait();
      }

      // 投喂
      const txDonate = await gameContract.donate(donateModal.boxId, token, parsedAmount);
      await txDonate.wait();
      
      showToast(`🎉 投喂成功！`, "success");
      setDonateModal({ ...donateModal, show: false });
      scanMaxBalance(); // 刷新奖池
    } catch (e) {
      console.error(e);
      showToast("❌ 投喂失败", "error");
    }
  };

  // --- 渲染 ---
  return (
    <div className="min-h-screen flex flex-col items-center p-3 pb-20 md:p-4 bg-slate-900 text-white font-sans">
      <style>{`
        @keyframes shake {
          0% { transform: translate(1px, 1px) rotate(0deg); } 10% { transform: translate(-1px, -2px) rotate(-1deg); }
          20% { transform: translate(-3px, 0px) rotate(1deg); } 30% { transform: translate(3px, 2px) rotate(0deg); }
          40% { transform: translate(1px, -1px) rotate(1deg); } 50% { transform: translate(-1px, 2px) rotate(-1deg); }
          60% { transform: translate(-3px, 1px) rotate(0deg); } 70% { transform: translate(3px, 1px) rotate(-1deg); }
          80% { transform: translate(-1px, -1px) rotate(1deg); } 90% { transform: translate(1px, 2px) rotate(0deg); }
          100% { transform: translate(1px, -2px) rotate(-1deg); }
        }
        .shaking { animation: shake 0.5s infinite; }
      `}</style>

      {/* 头部导航 */}
      <header className="w-full max-w-5xl flex flex-col md:flex-row justify-between items-center mb-4 p-3 bg-slate-800 rounded-xl border border-slate-700 shadow-lg gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center text-lg font-bold text-black">W</div>
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-orange-500">wukong盲盒</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <a href="https://year.wukong.lol/" target="_blank" rel="noreferrer" className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg font-semibold transition shadow-lg shadow-purple-500/30 flex items-center gap-1 text-xs md:text-sm text-white no-underline">
            <span>📅</span> 打卡领 LIFT
          </a>
          <button onClick={connectWallet} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold transition shadow-lg shadow-blue-500/30 text-xs md:text-sm">
            {userAddr ? `${userAddr.slice(0, 4)}..${userAddr.slice(-4)}` : "连接钱包"}
          </button>
        </div>
      </header>

      {/* 神秘大奖池面板 */}
      <div className="w-full max-w-5xl mb-4 relative group cursor-pointer" onClick={scanMaxBalance}>
        <div className="absolute inset-0 bg-gradient-to-r from-yellow-600 to-orange-600 rounded-2xl blur opacity-30 group-hover:opacity-50 transition"></div>
        <div className="relative bg-slate-900 border border-yellow-500/30 rounded-2xl p-3 md:p-4 overflow-hidden">
          <div className="text-center mb-3 md:mb-4">
            <h2 className="text-yellow-500 font-bold text-sm md:text-base uppercase tracking-wider mb-1">🏆 全场最高神秘奖池</h2>
            <div className="flex items-center justify-center gap-2">
              <span className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 to-yellow-500">
                {maxBalance}
              </span>
              <span className="text-lg text-yellow-600 font-bold">LIFT</span>
            </div>
            <p className="text-gray-400 text-[10px] md:text-xs mt-1 flex items-center justify-center gap-1">
              <span>{isScanning ? "扫描中..." : "点击扫描全网 120 个盲盒，寻找最大宝藏"}</span>
              <svg className={`h-3 w-3 ${isScanning ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </p>
          </div>
          {/* 规则 */}
          <div className="border-t border-yellow-500/20 pt-3 grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4 text-xs">
            <div className="bg-slate-800/50 p-2 rounded border border-slate-700/50 flex flex-col justify-center">
              <h3 className="text-yellow-400 font-bold mb-1">🎮 玩法</h3>
              <p className="text-gray-400 leading-snug">消耗 <span className="text-white">100 LIFT</span> 开箱，随机赢取余额的 <span className="text-yellow-400">10%-90%</span>。</p>
            </div>
            <div className="bg-slate-800/50 p-2 rounded border border-slate-700/50 flex flex-col justify-center">
              <h3 className="text-pink-400 font-bold mb-1">🍬 投喂</h3>
              <p className="text-gray-400 leading-snug">点箱子右下角 <span className="text-pink-400">🍬</span>，欢迎投喂任意代币，让宝箱充满惊喜！</p>
            </div>
            <div className="bg-slate-800/50 p-2 rounded border border-slate-700/50 flex flex-col justify-center">
              <h3 className="text-green-400 font-bold mb-1">💰 返奖</h3>
              <p className="text-gray-400 leading-snug"><span className="text-green-400">98%</span> 费用直接回流奖池，<span className="text-gray-500">2%</span> 留存。拒绝抽水！</p>
            </div>
          </div>
        </div>
      </div>

      {/* 状态面板 */}
      <div className={`w-full max-w-5xl mb-4 ${!userAddr ? 'hidden' : ''}`}>
        <div className="flex flex-row justify-between items-center bg-slate-800 p-3 rounded-xl border border-slate-700 gap-4">
          <div className="flex items-center gap-3">
            <div className="text-xs">
              <p className="text-gray-500 font-bold">余额</p>
              <p className="text-lg font-mono text-yellow-400 leading-none">{balance}</p>
            </div>
            <div className="w-px h-8 bg-slate-700"></div>
            <div className="text-xs">
              <p className="text-gray-500 font-bold">状态</p>
              <p className={`text-sm font-bold leading-none ${isApproved ? 'text-green-400' : 'text-red-400'}`}>
                {isApproved ? "已授权" : "未授权"}
              </p>
            </div>
          </div>
          {!isApproved && (
            <button onClick={approveToken} className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-xs font-bold rounded transition shadow-lg shadow-green-500/20 whitespace-nowrap">
              点击授权
            </button>
          )}
        </div>
      </div>

      {/* 盲盒网格 */}
      <main className="w-full max-w-5xl">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-8 lg:grid-cols-10 gap-3 md:gap-4">
          {Array.from({ length: BOX_COUNT }, (_, i) => i + 1).map((i) => (
            <div 
              key={i} 
              onClick={() => onBoxClick(i)}
              className={`aspect-square bg-slate-800 rounded-xl border border-slate-700 flex flex-col items-center justify-center relative overflow-hidden group hover:border-yellow-500/50 cursor-pointer transition-all hover:-translate-y-1 hover:shadow-xl active:scale-95 ${shakingBox === i ? 'shaking border-yellow-500' : ''}`}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-slate-700/50 to-transparent opacity-0 group-hover:opacity-100 transition pointer-events-none"></div>
              <span className="text-2xl md:text-3xl mb-0.5 group-hover:scale-110 transition pointer-events-none">📦</span>
              <span className="text-[10px] text-gray-500 font-mono pointer-events-none">#{i}</span>
              <button 
                onClick={(e) => { e.stopPropagation(); setDonateModal({ show: true, boxId: i }); }}
                className="absolute bottom-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-slate-700 hover:bg-pink-600 text-[8px] transition opacity-0 group-hover:opacity-100 shadow-lg z-10"
                title="投喂"
              >
                🍬
              </button>
            </div>
          ))}
        </div>
      </main>

      {/* 结果弹窗 */}
      {resultModal.show && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 p-6 md:p-8 rounded-2xl max-w-xs w-full text-center border-2 border-yellow-500 shadow-2xl">
            <h2 className="text-2xl font-bold mb-4 text-white">
              {parseFloat(resultModal.amount) > 0 ? "恭喜中奖!" : "哎呀..."}
            </h2>
            <div className="text-5xl mb-4">🎁</div>
            <p className="text-gray-300 text-base mb-6">
              {parseFloat(resultModal.amount) > 0 ? (
                <>你获得了 <span className="text-yellow-400 font-bold text-xl">{parseFloat(resultModal.amount).toFixed(2)}</span> LIFT</>
              ) : (
                <>本次未中奖<br /><span className="text-sm text-gray-400">别灰心，下次一定中！</span></>
              )}
            </p>
            <button onClick={() => setResultModal({ ...resultModal, show: false })} className="w-full py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl transition transform hover:scale-105">
              继续开箱
            </button>
          </div>
        </div>
      )}

      {/* 投喂弹窗 */}
      {donateModal.show && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 p-5 rounded-2xl max-w-xs w-full border border-slate-600 shadow-2xl relative">
            <button onClick={() => setDonateModal({ ...donateModal, show: false })} className="absolute top-3 right-3 text-gray-400 hover:text-white">✕</button>
            <h3 className="text-lg font-bold mb-1 text-pink-400 flex items-center gap-2">🍬 投喂箱子 #{donateModal.boxId}</h3>
            <p className="text-[10px] text-gray-400 mb-4">欢迎投喂任意代币，让宝箱充满惊喜！</p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">代币合约地址</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={donateInput.token}
                    onChange={(e) => setDonateInput({...donateInput, token: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs focus:border-pink-500 outline-none text-white" 
                  />
                  <button onClick={() => setDonateInput({...donateInput, token: LIFT_TOKEN_ADDR})} className="px-2 py-1 text-[10px] bg-slate-700 hover:bg-slate-600 rounded whitespace-nowrap">重置</button>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">投喂数量</label>
                <input 
                  type="number" 
                  value={donateInput.amount}
                  onChange={(e) => setDonateInput({...donateInput, amount: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs focus:border-pink-500 outline-none text-white" 
                  placeholder="例如: 1000" 
                />
              </div>
              <button onClick={handleDonate} className="w-full py-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold rounded-lg transition text-sm">
                确认投喂
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast.show && (
        <div className={`fixed bottom-10 right-4 left-4 md:left-auto md:right-10 px-4 py-3 rounded shadow-2xl z-50 text-sm flex items-center justify-center md:justify-start gap-2 transition-all ${toast.type === 'error' ? 'bg-red-900 border-l-4 border-red-500' : toast.type === 'success' ? 'bg-green-900 border-l-4 border-green-500' : 'bg-slate-800 border-l-4 border-blue-500'}`}>
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}