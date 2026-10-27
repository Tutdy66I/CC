// Windows-only resource host. No numerical implementation lives here.
using System;
using System.Text;
using System.IO;
using System.ComponentModel;
using System.Threading;
using System.Runtime.InteropServices;
public sealed class OfdmStudyGuard : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct BASIC { public long User,Job; public uint Flags; public UIntPtr Min,Max; public uint Count; public UIntPtr Affinity; public uint Priority,Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct LIMIT { public BASIC Basic; public IO Io; public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct START { public uint cb; public string reserved,desktop,title; public uint x,y,xsize,ysize,xcount,ycount,fill,flags; public ushort show,reserved2; public IntPtr reservedPtr,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct INFO { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct MEMORY { public uint cb,faults; public UIntPtr peak,working,a,b,c,d,e,f,g; }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string b);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j,int c,ref LIMIT l,uint n);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr j,int c,out LIMIT l,uint n,IntPtr r);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcess(string app,StringBuilder args,IntPtr p,IntPtr t,bool inherit,uint flags,IntPtr env,string cwd,ref START s,out INFO i);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetProcessWorkingSetSizeEx(IntPtr p,UIntPtr min,UIntPtr max,uint flags);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessWorkingSetSizeEx(IntPtr p,out UIntPtr min,out UIntPtr max,out uint flags);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr h,uint mask,uint flags);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr p,uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr p,out uint exit);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr p,uint exit);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr p,uint exit);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr p);
  [DllImport("psapi.dll",SetLastError=true)] static extern bool GetProcessMemoryInfo(IntPtr p,ref MEMORY m,uint n);
  IntPtr job; INFO info; FileStream log;
  readonly object sync=new object(); Timer deadline; volatile bool expired;
  readonly System.Diagnostics.Stopwatch clock=System.Diagnostics.Stopwatch.StartNew();
  long deadlineAt=long.MaxValue; bool deadlineKillsOwner;
  public bool DeadlineExpired { get { return expired; } }
  public int Pid { get { return (int)info.pid; } }
  public bool HardWorkingSet { get; private set; }
  public ulong WorkingSetCeilingBytes { get; private set; }
  static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string s) { var b=new StringBuilder("\""); int slashes=0; foreach(char c in s) { if(c=='\\') { slashes++; continue; } if(c=='\"') { b.Append('\\',slashes*2+1); b.Append(c); } else { b.Append('\\',slashes); b.Append(c); } slashes=0; } b.Append('\\',slashes*2); return b.Append('"').ToString(); }
  public static OfdmStudyGuard Start(string node,string[] args,string cwd,string logPath) {
    var g=new OfdmStudyGuard();
    try {
      g.job=CreateJobObject(IntPtr.Zero,null); Check(g.job!=IntPtr.Zero);
      var l=new LIMIT(); l.Basic.Flags=0x2000|0x100|0x200;
      l.ProcessMemory=l.JobMemory=(UIntPtr)(512UL*1024*1024);
      Check(SetInformationJobObject(g.job,9,ref l,(uint)Marshal.SizeOf(l)));
      g.log=new FileStream(logPath,FileMode.CreateNew,FileAccess.Write,FileShare.Read);
      IntPtr output=g.log.SafeFileHandle.DangerousGetHandle(); Check(SetHandleInformation(output,1,1));
      var s=new START(); s.cb=(uint)Marshal.SizeOf(s); s.flags=0x100; s.output=s.error=output;
      var cmd=new StringBuilder(Quote(node)); foreach(string a in args) cmd.Append(' ').Append(Quote(a));
      Check(CreateProcess(node,cmd,IntPtr.Zero,IntPtr.Zero,true,0x08000000|4,IntPtr.Zero,cwd,ref s,out g.info));
      Check(AssignProcessToJobObject(g.job,g.info.process));
      // Keep 1 MiB inside the frozen 512 MiB budget: Windows pressure probes can exceed the configured ceiling by one page.
      bool configured=SetProcessWorkingSetSizeEx(g.info.process,(UIntPtr)(80UL*1024),(UIntPtr)(511UL*1024*1024),4|2);
      if(!configured) throw new Win32Exception(Marshal.GetLastWin32Error(),"Start refused: native hard working-set cap unavailable");
      UIntPtr min,max; uint flags; Check(GetProcessWorkingSetSizeEx(g.info.process,out min,out max,out flags));
      g.WorkingSetCeilingBytes=max.ToUInt64();
      g.HardWorkingSet=configured && (flags&4)!=0 && max.ToUInt64()<=511UL*1024*1024;
      if(!g.HardWorkingSet) throw new Exception("Hard native working-set cap not enforced");
      return g;
    } catch { g.Dispose(); throw; }
  }
  public void Resume() { if(ResumeThread(info.thread)==0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  void Expire() {
    expired=true; if(job!=IntPtr.Zero) TerminateJobObject(job,137);
    if(deadlineKillsOwner) TerminateProcess(System.Diagnostics.Process.GetCurrentProcess().Handle,137);
  }
  public void SetDeadlineMilliseconds(int remaining,bool killOwner) {
    lock(sync) {
      if(expired) throw new Exception("Native deadline already expired");
      deadlineKillsOwner=killOwner; deadlineAt=clock.ElapsedMilliseconds+remaining;
      if(remaining<=0) { Expire(); return; }
      if(deadline==null) deadline=new Timer(delegate(object state) { lock(sync) {
        long left=deadlineAt-clock.ElapsedMilliseconds;
        if(left>0) { deadline.Change((int)Math.Min(left,int.MaxValue),Timeout.Infinite); return; }
        Expire();
      } },null,remaining,Timeout.Infinite);
      else deadline.Change(remaining,Timeout.Infinite);
    }
  }
  public bool Exited { get { return WaitForSingleObject(info.process,0)==0; } }
  public uint ExitCode { get { uint x; GetExitCodeProcess(info.process,out x); return x; } }
  public ulong PeakBytes { get { var m=new MEMORY(); m.cb=(uint)Marshal.SizeOf(m); Check(GetProcessMemoryInfo(info.process,ref m,m.cb)); return m.peak.ToUInt64(); } }
  public ulong PeakJobCommitBytes { get { LIMIT l; Check(QueryInformationJobObject(job,9,out l,(uint)Marshal.SizeOf(typeof(LIMIT)),IntPtr.Zero)); return l.PeakJob.ToUInt64(); } }
  public void Kill() { if(job!=IntPtr.Zero) TerminateJobObject(job,137); }
  public void Dispose() { lock(sync) { if(!expired && deadline!=null && clock.ElapsedMilliseconds>=deadlineAt) Expire(); if(deadline!=null) { deadline.Dispose(); deadline=null; } Kill(); if(info.thread!=IntPtr.Zero) { CloseHandle(info.thread); info.thread=IntPtr.Zero; } if(info.process!=IntPtr.Zero) { TerminateProcess(info.process,137); CloseHandle(info.process); info.process=IntPtr.Zero; } if(job!=IntPtr.Zero) CloseHandle(job); job=IntPtr.Zero; if(log!=null) { log.Dispose(); log=null; } } }
}
