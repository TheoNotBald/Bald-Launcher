package bl.util;

public final class TimerUtil {

    private long last = System.nanoTime();

    public boolean passed(long milliseconds) {
        return elapsed() >= milliseconds;
    }

    public void reset() {
        last = System.nanoTime();
    }

    public long elapsed() {
        return (System.nanoTime() - last) / 1_000_000L;
    }
}
